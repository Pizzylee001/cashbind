import {
  binToHex,
  cashAddressToLockingBytecode,
  encodeDataPush,
  encodeTransactionBCH,
  generateSigningSerializationBCH,
  hexToBin,
  secp256k1,
  sha256,
  SigningSerializationFlag,
  type Output,
  type TransactionBCH,
} from '@bitauth/libauth';
import { normalizeCashAddress } from './protocol';

export const DUST_LIMIT_SATS = 546;
export const DEFAULT_FEE_RATE_SAT_PER_BYTE = 1.2;

export interface BchUtxo {
  txid: string;
  vout: number;
  value: number;
  height?: number;
}

export interface BchPaymentOutput {
  address: string;
  satoshis: number;
}

export interface BuildTxParams {
  senderAddress: string;
  utxos: BchUtxo[];
  outputs: BchPaymentOutput[];
  opReturnScriptHex?: string;
  feeRateSatPerByte?: number;
}

export interface UnsignedBchTxPlan {
  transaction: TransactionBCH;
  sourceOutputs: Output[];
  selectedUtxos: BchUtxo[];
  feeSats: number;
  changeSats: number;
  totalInputSats: number;
  totalOutputSats: number;
  estimatedBytes: number;
}

export interface SignedBchTxResult extends UnsignedBchTxPlan {
  rawTxHex: string;
  txid: string;
}

function estimateTxBytes(inputCount: number, outputCount: number, opReturnBytes: number): number {
  const base = 10;
  const inputsSize = inputCount * 148;
  const outputsSize = outputCount * 34;
  const opReturnSize = opReturnBytes > 0 ? 10 + opReturnBytes : 0;
  return base + inputsSize + outputsSize + opReturnSize;
}

function addressToLockingBytes(address: string): Uint8Array {
  const normalized = normalizeCashAddress(address);
  const result = cashAddressToLockingBytecode(normalized);
  if (typeof result === 'string') {
    throw new Error(`Invalid BCH destination address: ${result}`);
  }
  return result.bytecode;
}

export function buildUnsignedBchTransaction(params: BuildTxParams): UnsignedBchTxPlan {
  const senderNormalized = normalizeCashAddress(params.senderAddress);
  const senderLocking = addressToLockingBytes(senderNormalized);
  const feeRate = Math.max(1.0, params.feeRateSatPerByte ?? DEFAULT_FEE_RATE_SAT_PER_BYTE);
  const opReturnBytes = params.opReturnScriptHex ? hexToBin(params.opReturnScriptHex) : null;

  for (const out of params.outputs) {
    if (!Number.isInteger(out.satoshis) || out.satoshis < DUST_LIMIT_SATS) {
      throw new Error(`Every BCH output must be an integer >= ${DUST_LIMIT_SATS} satoshis (dust limit).`);
    }
  }

  if (params.utxos.length === 0) {
    throw new Error('Insufficient funds: no spendable UTXOs found for this BCH address.');
  }

  const sortedUtxos = [...params.utxos].sort((a, b) => b.value - a.value);
  const totalOutputSats = params.outputs.reduce((sum, o) => sum + o.satoshis, 0);

  const selectedUtxos: BchUtxo[] = [];
  let totalInputSats = 0;
  let estimatedBytes = 0;
  let feeSats = 0;

  for (const utxo of sortedUtxos) {
    selectedUtxos.push(utxo);
    totalInputSats += utxo.value;
    // Account for a potential change output
    estimatedBytes = estimateTxBytes(
      selectedUtxos.length,
      params.outputs.length + 1,
      opReturnBytes ? opReturnBytes.length : 0,
    );
    feeSats = Math.ceil(estimatedBytes * feeRate);
    const remaining = totalInputSats - totalOutputSats - feeSats;
    if (remaining >= 0) {
      break;
    }
  }

  if (totalInputSats < totalOutputSats + feeSats) {
    throw new Error(
      `Insufficient funds: need ${totalOutputSats + feeSats} sats (including ${feeSats} sat fee), available ${totalInputSats} sats.`,
    );
  }

  const txOutputs: Output[] = [];

  if (opReturnBytes) {
    txOutputs.push({
      lockingBytecode: opReturnBytes,
      valueSatoshis: 0n,
    });
  }

  for (const out of params.outputs) {
    txOutputs.push({
      lockingBytecode: addressToLockingBytes(out.address),
      valueSatoshis: BigInt(out.satoshis),
    });
  }

  let changeSats = totalInputSats - totalOutputSats - feeSats;
  if (changeSats >= DUST_LIMIT_SATS) {
    txOutputs.push({
      lockingBytecode: senderLocking,
      valueSatoshis: BigInt(changeSats),
    });
  } else {
    // Absorb sub-dust remainder into miner fee rather than creating an unspendable dust output
    feeSats += changeSats;
    changeSats = 0;
  }

  if (txOutputs.length === 0) {
    throw new Error('Transaction must contain at least one output.');
  }

  const transaction: TransactionBCH = {
    version: 2,
    locktime: 0,
    inputs: selectedUtxos.map((u) => ({
      outpointIndex: u.vout,
      outpointTransactionHash: hexToBin(u.txid).reverse(),
      sequenceNumber: 0xffffffff,
      unlockingBytecode: new Uint8Array(),
    })),
    outputs: txOutputs,
  };

  const sourceOutputs: Output[] = selectedUtxos.map((u) => ({
    lockingBytecode: senderLocking,
    valueSatoshis: BigInt(u.value),
  }));

  return {
    transaction,
    sourceOutputs,
    selectedUtxos,
    feeSats,
    changeSats,
    totalInputSats,
    totalOutputSats,
    estimatedBytes,
  };
}

export function buildSignedBchTransaction(
  params: BuildTxParams & { senderPrivateKeyHex: string },
): SignedBchTxResult {
  const plan = buildUnsignedBchTransaction(params);
  const privBytes = hexToBin(params.senderPrivateKeyHex.trim());
  const pubBytes = secp256k1.derivePublicKeyCompressed(privBytes);
  if (typeof pubBytes === 'string') {
    throw new Error(`Invalid BCH signing key: ${pubBytes}`);
  }

  const sighashType = Uint8Array.of(
    SigningSerializationFlag.allOutputs | SigningSerializationFlag.forkId,
  );

  const signedInputs = plan.transaction.inputs.map((input, inputIndex) => {
    const coveredBytecode = plan.sourceOutputs[inputIndex].lockingBytecode;
    const preimage = generateSigningSerializationBCH(
      {
        inputIndex,
        sourceOutputs: plan.sourceOutputs,
        transaction: plan.transaction,
      },
      {
        coveredBytecode,
        signingSerializationType: sighashType,
      },
    );
    const sighash = sha256.hash(sha256.hash(preimage));
    const derSig = secp256k1.signMessageHashDER(privBytes, sighash);
    if (typeof derSig === 'string') {
      throw new Error(`Failed to sign BCH input #${inputIndex}: ${derSig}`);
    }
    const sigWithType = new Uint8Array(derSig.length + 1);
    sigWithType.set(derSig, 0);
    sigWithType[derSig.length] = sighashType[0];

    const pushSig = encodeDataPush(sigWithType);
    const pushPub = encodeDataPush(pubBytes);
    const unlockingBytecode = new Uint8Array(pushSig.length + pushPub.length);
    unlockingBytecode.set(pushSig, 0);
    unlockingBytecode.set(pushPub, pushSig.length);

    return {
      ...input,
      unlockingBytecode,
    };
  });

  const signedTx: TransactionBCH = {
    ...plan.transaction,
    inputs: signedInputs,
  };

  const rawBytes = encodeTransactionBCH(signedTx);
  const rawTxHex = binToHex(rawBytes);
  const txid = binToHex(new Uint8Array(sha256.hash(sha256.hash(rawBytes))).reverse());

  return {
    ...plan,
    transaction: signedTx,
    rawTxHex,
    txid,
  };
}
