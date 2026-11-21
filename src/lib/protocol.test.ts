import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateBchIdentity,
  generateNostrIdentity,
  importBchWif,
  importNostrNsec,
  canonicalizeBindingPayload,
  computeBindingHash,
  signBchMessage,
  verifyBchMessage,
  createSignedBindingBundle,
  verifyBindingBundle,
  encodeCashBindOpReturn,
  decodeCashBindOpReturn,
  verifyOnChainCommitment,
  verifyRotationChain,
  createAuthChallenge,
  signAuthChallengeWithBch,
  signAuthChallengeWithNostr,
  verifyAuthChallengeResponse,
  createSignedAttestation,
  verifySignedAttestation,
  exportDidNostrDocument,
  bchAddressToElectrumScriptHash,
} from './protocol';
import {
  buildUnsignedBchTransaction,
  buildSignedBchTransaction,
  DUST_LIMIT_SATS,
} from './bchTx';
import { decodeTransactionBCH, hexToBin, binToHex } from '@bitauth/libauth';

test('generates distinct BCH and Nostr identities with valid round-trip import', () => {
  const bch = generateBchIdentity();
  const nostr = generateNostrIdentity();

  assert.match(bch.address, /^bitcoincash:q[0-9a-z]{41}$/);
  assert.equal(bch.publicKeyHex.length, 66);
  assert.match(nostr.npub, /^npub1[0-9a-z]+$/);
  assert.equal(nostr.publicKeyHex.length, 64);

  const importedBch = importBchWif(bch.wif);
  assert.equal(importedBch.address, bch.address);
  assert.equal(importedBch.publicKeyHex, bch.publicKeyHex);

  const importedNostr = importNostrNsec(nostr.nsec);
  assert.equal(importedNostr.publicKeyHex, nostr.publicKeyHex);
  assert.equal(importedNostr.npub, nostr.npub);
});

test('BCH Bitcoin Signed Message signs and verifies accurately and rejects tampering', () => {
  const bch = generateBchIdentity();
  const msg = 'CashBind test payload v1';
  const sig = signBchMessage(msg, bch.privateKeyHex);

  const valid = verifyBchMessage(msg, sig, bch.address, bch.publicKeyHex);
  assert.equal(valid.valid, true);
  assert.equal(valid.recoveredAddress, bch.address);

  const tamperedMsg = verifyBchMessage(msg + '!', sig, bch.address, bch.publicKeyHex);
  assert.equal(tamperedMsg.valid, false);

  const otherBch = generateBchIdentity();
  const wrongAddr = verifyBchMessage(msg, sig, otherBch.address, otherBch.publicKeyHex);
  assert.equal(wrongAddr.valid, false);
});

test('creates and verifies bidirectional cross-signed CashBind bundle with distinct keys', () => {
  const bch = generateBchIdentity();
  const nostr = generateNostrIdentity();

  const bundle = createSignedBindingBundle({
    bchPrivateKeyHex: bch.privateKeyHex,
    nostrPrivateKeyHex: nostr.privateKeyHex,
    handle: 'merchant.bch',
    relays: ['wss://relay.damus.io', 'wss://nos.lol'],
  });

  const verification = verifyBindingBundle(bundle);
  assert.equal(verification.valid, true);
  assert.equal(verification.checks.distinctKeys.ok, true);
  assert.equal(verification.checks.bchSignature.ok, true);
  assert.equal(verification.checks.nostrSignature.ok, true);
  assert.equal(verification.checks.payloadHashMatch.ok, true);

  // Tamper with handle inside payload
  const tampered = structuredClone(bundle);
  tampered.payload.handle = 'attacker.bch';
  const tamperedResult = verifyBindingBundle(tampered);
  assert.equal(tamperedResult.valid, false);
});

test('rejects binding when BCH and Nostr reuse the exact same private key', () => {
  const bch = generateBchIdentity();

  assert.throws(
    () =>
      createSignedBindingBundle({
        bchPrivateKeyHex: bch.privateKeyHex,
        nostrPrivateKeyHex: bch.privateKeyHex,
        handle: 'reused.bch',
      }),
    /distinct/i,
  );
});

test('encodes and decodes CASHBIND OP_RETURN commitment script cleanly', () => {
  const payload = canonicalizeBindingPayload({
    version: 1,
    domain: 'cashbind.protocol/v1',
    nostrPubkey: 'a'.repeat(64),
    bchAddress: 'bitcoincash:qpw7m7leafvem48ref4gpvenc3e06zeldy70v28d52',
    bchPubkey: '02' + 'b'.repeat(64),
    handle: 'notary.bch',
    issuedAt: 1763600000,
  });
  const hashHex = computeBindingHash(payload);
  const scriptBytes = encodeCashBindOpReturn(hashHex);
  const decoded = decodeCashBindOpReturn(binToHex(scriptBytes));

  assert.ok(decoded);
  assert.equal(decoded.protocol, 'CASHBIND');
  assert.equal(decoded.version, 'v1');
  assert.equal(decoded.bindingHash, hashHex);

  const matchCheck = verifyOnChainCommitment(
    [{ scriptPubKeyHex: binToHex(scriptBytes), valueSats: 0 }],
    hashHex,
  );
  assert.equal(matchCheck.matched, true);
});

test('builds a valid signed BCH mainnet P2PKH + OP_RETURN transaction and enforces dust/fee rules', () => {
  const sender = generateBchIdentity();
  const recipient = generateBchIdentity();
  const commitmentHash = '12'.repeat(32);

  const utxos = [
    {
      txid: 'ab'.repeat(32),
      vout: 0,
      value: 25000,
    },
  ];

  // Anchor tx (self-send with OP_RETURN)
  const anchorBuilt = buildSignedBchTransaction({
    senderPrivateKeyHex: sender.privateKeyHex,
    senderAddress: sender.address,
    utxos,
    outputs: [],
    opReturnScriptHex: binToHex(encodeCashBindOpReturn(commitmentHash)),
    feeRateSatPerByte: 1.2,
  });

  assert.ok(anchorBuilt.rawTxHex.length > 100);
  assert.equal(anchorBuilt.txid.length, 64);
  assert.ok(anchorBuilt.feeSats >= 200);
  assert.ok(anchorBuilt.changeSats >= DUST_LIMIT_SATS);

  const decoded = decodeTransactionBCH(hexToBin(anchorBuilt.rawTxHex));
  assert.notEqual(typeof decoded, 'string');
  if (typeof decoded !== 'string') {
    assert.equal(decoded.outputs.length, 2);
    const opRetHex = binToHex(decoded.outputs[0].lockingBytecode);
    const parsed = decodeCashBindOpReturn(opRetHex);
    assert.equal(parsed?.bindingHash, commitmentHash);
  }

  // Direct payment tx to verified recipient
  const payBuilt = buildSignedBchTransaction({
    senderPrivateKeyHex: sender.privateKeyHex,
    senderAddress: sender.address,
    utxos,
    outputs: [{ address: recipient.address, satoshis: 5000 }],
    feeRateSatPerByte: 1.2,
  });
  assert.ok(payBuilt.rawTxHex.length > 100);
  assert.equal(payBuilt.totalOutputSats, 5000);

  // Unsigned WizardConnect tx payload builds cleanly
  const unsignedWc = buildUnsignedBchTransaction({
    senderAddress: sender.address,
    utxos,
    outputs: [{ address: recipient.address, satoshis: 5000 }],
    opReturnScriptHex: binToHex(encodeCashBindOpReturn(commitmentHash)),
    feeRateSatPerByte: 1.2,
  });
  assert.equal(unsignedWc.sourceOutputs.length, 1);
  assert.equal(unsignedWc.transaction.inputs.length, 1);

  // Insufficient funds throws clear error
  assert.throws(
    () =>
      buildSignedBchTransaction({
        senderPrivateKeyHex: sender.privateKeyHex,
        senderAddress: sender.address,
        utxos: [{ txid: 'cd'.repeat(32), vout: 0, value: 400 }],
        outputs: [{ address: recipient.address, satoshis: 1000 }],
      }),
    /insufficient/i,
  );
});

test('verifies key-rotation chain linking successor binding to previous binding hash', () => {
  const bch1 = generateBchIdentity();
  const bch2 = generateBchIdentity();
  const nostr = generateNostrIdentity();

  const b1 = createSignedBindingBundle({
    bchPrivateKeyHex: bch1.privateKeyHex,
    nostrPrivateKeyHex: nostr.privateKeyHex,
    handle: 'store.bch',
  });

  const b2 = createSignedBindingBundle({
    bchPrivateKeyHex: bch2.privateKeyHex,
    nostrPrivateKeyHex: nostr.privateKeyHex,
    handle: 'store.bch',
    prevBindingHash: b1.bindingHash,
    prevTxid: 'ff'.repeat(32),
  });

  const chainCheck = verifyRotationChain([b1, b2]);
  assert.equal(chainCheck.valid, true);
  assert.equal(chainCheck.depth, 2);

  // Broken link fails
  const broken = structuredClone(b2);
  broken.payload.prevBindingHash = '00'.repeat(32);
  const brokenCheck = verifyRotationChain([b1, broken]);
  assert.equal(brokenCheck.valid, false);
});

test('stateless challenge-response authentication verifies Nostr and BCH proofs and rejects expired challenges', () => {
  const bch = generateBchIdentity();
  const nostr = generateNostrIdentity();
  const bundle = createSignedBindingBundle({
    bchPrivateKeyHex: bch.privateKeyHex,
    nostrPrivateKeyHex: nostr.privateKeyHex,
    handle: 'alice.bch',
  });

  const challenge = createAuthChallenge('cashbind.app', 300);

  const bchProof = signAuthChallengeWithBch(challenge, bch.privateKeyHex, bch.address);
  const bchVerify = verifyAuthChallengeResponse(challenge, bchProof, bundle);
  assert.equal(bchVerify.valid, true);

  const nostrProof = signAuthChallengeWithNostr(challenge, nostr.privateKeyHex);
  const nostrVerify = verifyAuthChallengeResponse(challenge, nostrProof, bundle);
  assert.equal(nostrVerify.valid, true);

  const expiredChallenge = { ...challenge, expiresAt: Math.floor(Date.now() / 1000) - 10 };
  const expiredVerify = verifyAuthChallengeResponse(expiredChallenge, nostrProof, bundle);
  assert.equal(expiredVerify.valid, false);
});

test('signs and verifies portable third-party attestations and exports W3C did:nostr document', () => {
  const subjectBch = generateBchIdentity();
  const subjectNostr = generateNostrIdentity();
  const issuerNostr = generateNostrIdentity();

  const bundle = createSignedBindingBundle({
    bchPrivateKeyHex: subjectBch.privateKeyHex,
    nostrPrivateKeyHex: subjectNostr.privateKeyHex,
    handle: 'ravish.bch',
  });

  const attestation = createSignedAttestation({
    issuerNostrPrivateKeyHex: issuerNostr.privateKeyHex,
    issuerLabel: 'BCH Merchant Guild',
    subjectBindingHash: bundle.bindingHash,
    subjectNostrPubkey: bundle.payload.nostrPubkey,
    subjectBchAddress: bundle.payload.bchAddress,
    claimType: 'verified-merchant',
    claimStatement: 'Confirmed physical storefront accepting BCH mainnet payments.',
  });

  const attCheck = verifySignedAttestation(attestation, bundle);
  assert.equal(attCheck.valid, true);

  const didDoc = exportDidNostrDocument(bundle, 'ee'.repeat(32), [attestation]);
  assert.equal(didDoc.id, `did:nostr:${bundle.payload.nostrPubkey}`);
  assert.equal(didDoc.verificationMethod.length, 2);
  assert.ok(didDoc.service.some((s) => s.type === 'BitcoinCashPaymentEndpoint'));
});

test('computes Fulcrum ElectrumX reversed sha256 scripthash for CashAddr', () => {
  const bch = generateBchIdentity();
  const scripthash = bchAddressToElectrumScriptHash(bch.address);
  assert.match(scripthash, /^[0-9a-f]{64}$/);
});
