import {
  PrivateKey,
  Field,
  UInt32,
  Encryption,
  Signature,
  Circuit,
} from 'snarkyjs';
import dotenv from 'dotenv';

dotenv.config();

import { PhaseState } from '../../../src/phase/PhaseState';
import { GameState } from '../../../src/game/GameState';
import { Action } from '../../../src/objects/Action';
import { Position } from '../../../src/objects/Position';
import { Piece } from '../../../src/objects/Piece';
import { Unit } from '../../../src/objects/Unit';
import { ArenaMerkleTree } from '../../../src/objects/ArenaMerkleTree';
import { PiecesMerkleTree } from '../../../src/objects/PiecesMerkleTree';
import { EncrytpedAttackRoll } from '../../../src/objects/AttackDiceRolls';
import {
  ARENA_WIDTH_U32,
  ARENA_HEIGHT_U32,
  MELEE_ATTACK_RANGE,
} from '../../../src/gameplay_constants';

describe('PhaseState', () => {
  let player1PrivateKey: PrivateKey;
  let player2PrivateKey: PrivateKey;
  let serverPrivateKey: PrivateKey;
  const rngPrivateKey: PrivateKey = PrivateKey.fromBase58(
    process.env.RNG_PRIVATE_KEY || ''
  );
  let gameState: GameState;
  let initialPhaseState: PhaseState;
  let piecesTree: PiecesMerkleTree;
  let arenaTree: ArenaMerkleTree;
  beforeEach(async () => {
    player1PrivateKey = PrivateKey.random();
    player2PrivateKey = PrivateKey.random();
    serverPrivateKey = PrivateKey.random();
    piecesTree = new PiecesMerkleTree();
    arenaTree = new ArenaMerkleTree();
  });

  describe('applyMeleeAttack', () => {
    let attackingPiecePosition: Position;
    let targetPiece1Position: Position;
    let targetPiece2Position: Position;
    let attackingPiece: Piece;
    let targetPiece1: Piece;
    let targetPiece2: Piece;
    let attack1: Action;
    let attack2: Action;
    let diceRolls: EncrytpedAttackRoll;
    beforeEach(async () => {
      attackingPiecePosition = Position.fromXY(100, 100);
      targetPiece1Position = Position.fromXY(100, 100 + MELEE_ATTACK_RANGE - 5); // in range
      targetPiece2Position = Position.fromXY(100, 100 + MELEE_ATTACK_RANGE + 5); // out of range

      attackingPiece = new Piece({
        id: Field(1),
        playerPublicKey: player1PrivateKey.toPublicKey(),
        position: attackingPiecePosition,
        baseUnit: Unit.default(),
        condition: Unit.default().stats,
      });
      attackingPiece.condition.saveRoll = UInt32.from(0); // Ensure that attacker's save roll is not counted
      targetPiece1 = new Piece({
        id: Field(2),
        playerPublicKey: player2PrivateKey.toPublicKey(),
        position: targetPiece1Position,
        baseUnit: Unit.default(),
        condition: Unit.default().stats,
      });
      targetPiece2 = new Piece({
        id: Field(3),
        playerPublicKey: player2PrivateKey.toPublicKey(),
        position: targetPiece2Position,
        baseUnit: Unit.default(),
        condition: Unit.default().stats,
      });
      piecesTree.set(attackingPiece.id.toBigInt(), attackingPiece.hash());
      piecesTree.set(targetPiece1.id.toBigInt(), targetPiece1.hash());
      piecesTree.set(targetPiece2.id.toBigInt(), targetPiece2.hash());
      gameState = new GameState(
        piecesTree.tree.getRoot(),
        arenaTree.tree.getRoot(),
        Field(1),
        player1PrivateKey.toPublicKey(),
        player2PrivateKey.toPublicKey(),
        ARENA_HEIGHT_U32,
        ARENA_WIDTH_U32,
        Field(0)
      );

      initialPhaseState = new PhaseState({
        nonce: Field(0),
        actionsNonce: Field(0),
        startingPiecesState: gameState.piecesRoot,
        currentPiecesState: gameState.piecesRoot,
        startingArenaState: gameState.arenaRoot,
        currentArenaState: gameState.arenaRoot,
        playerPublicKey: player1PrivateKey.toPublicKey(),
      });

      attack1 = new Action({
        nonce: Field(1),
        actionType: Field(2),
        actionParams: targetPiece1.hash(),
        piece: Field(1),
      });
      attack2 = new Action({
        nonce: Field(1),
        actionType: Field(2),
        actionParams: targetPiece2.hash(),
        piece: Field(1),
      });
    });

    it('hits, wounds, doesnt save, is in range', async () => {
      const enc = Encryption.encrypt(
        [Field(6), Field(6), Field(1)],
        serverPrivateKey.toPublicKey()
      );
      const sig = Signature.create(rngPrivateKey, [
        Field(3),
        Field(6),
        ...enc.cipherText,
      ]);
      diceRolls = EncrytpedAttackRoll.init(enc.publicKey, enc.cipherText, sig);

      const piecesTreeBefore = piecesTree.clone();
      const attackDistance = MELEE_ATTACK_RANGE - 5;

      Circuit.runAndCheck(() => {
        const newPhaseState = initialPhaseState.applyMeleeAttackAction(
          attack1,
          attack1.sign(player1PrivateKey),
          attackingPiece.clone(),
          targetPiece1.clone(),
          piecesTree.getWitness(attackingPiece.id.toBigInt()),
          piecesTree.getWitness(targetPiece1.id.toBigInt()),
          UInt32.from(attackDistance),
          diceRolls,
          serverPrivateKey
        );

        const targetAfterAttack = targetPiece1.clone();
        targetAfterAttack.condition.health = UInt32.from(0); // took 3 damage
        piecesTree.set(
          targetAfterAttack.id.toBigInt(),
          targetAfterAttack.hash()
        );

        Circuit.asProver(() => {
          expect(newPhaseState.startingPiecesState.toString()).toBe(
            piecesTreeBefore.tree.getRoot().toString()
          );
          expect(newPhaseState.currentPiecesState.toString()).toBe(
            piecesTree.tree.getRoot().toString()
          );
        });
      });
    });

    it('hits, but does not wound, is in range', async () => {
      const enc = Encryption.encrypt(
        [Field(6), Field(1), Field(1)],
        serverPrivateKey.toPublicKey()
      );
      const sig = Signature.create(rngPrivateKey, [
        Field(3),
        Field(6),
        ...enc.cipherText,
      ]);
      diceRolls = EncrytpedAttackRoll.init(enc.publicKey, enc.cipherText, sig);

      const piecesTreeBefore = piecesTree.clone();
      const attackDistance = MELEE_ATTACK_RANGE - 5;

      Circuit.runAndCheck(() => {
        const newPhaseState = initialPhaseState.applyMeleeAttackAction(
          attack1,
          attack1.sign(player1PrivateKey),
          attackingPiece.clone(),
          targetPiece1.clone(),
          piecesTree.getWitness(attackingPiece.id.toBigInt()),
          piecesTree.getWitness(targetPiece1.id.toBigInt()),
          UInt32.from(attackDistance),
          diceRolls,
          serverPrivateKey
        );

        const targetAfterAttack = targetPiece1.clone();
        targetAfterAttack.condition.health = UInt32.from(3); // took no damage
        piecesTree.set(
          targetAfterAttack.id.toBigInt(),
          targetAfterAttack.hash()
        );

        Circuit.asProver(() => {
          expect(newPhaseState.startingPiecesState.toString()).toBe(
            piecesTreeBefore.tree.getRoot().toString()
          );
          expect(newPhaseState.currentPiecesState.toString()).toBe(
            piecesTree.tree.getRoot().toString()
          );
        });
      });
    });

    it('hits, wounds, and saves, is in range', async () => {
      const enc = Encryption.encrypt(
        [Field(6), Field(6), Field(6)],
        serverPrivateKey.toPublicKey()
      );
      const sig = Signature.create(rngPrivateKey, [
        Field(3),
        Field(6),
        ...enc.cipherText,
      ]);
      diceRolls = EncrytpedAttackRoll.init(enc.publicKey, enc.cipherText, sig);

      const piecesTreeBefore = piecesTree.clone();
      const attackDistance = MELEE_ATTACK_RANGE - 5;

      Circuit.runAndCheck(() => {
        const newPhaseState = initialPhaseState.applyMeleeAttackAction(
          attack1,
          attack1.sign(player1PrivateKey),
          attackingPiece.clone(),
          targetPiece1.clone(),
          piecesTree.getWitness(attackingPiece.id.toBigInt()),
          piecesTree.getWitness(targetPiece1.id.toBigInt()),
          UInt32.from(attackDistance),
          diceRolls,
          serverPrivateKey
        );

        const targetAfterAttack = targetPiece1.clone();
        targetAfterAttack.condition.health = UInt32.from(3); // took no damage
        piecesTree.set(
          targetAfterAttack.id.toBigInt(),
          targetAfterAttack.hash()
        );

        Circuit.asProver(() => {
          expect(newPhaseState.startingPiecesState.toString()).toBe(
            piecesTreeBefore.tree.getRoot().toString()
          );
          expect(newPhaseState.currentPiecesState.toString()).toBe(
            piecesTree.tree.getRoot().toString()
          );
        });
      });
    });

    it('is out of range', async () => {
      const enc = Encryption.encrypt(
        [Field(6), Field(6), Field(6)],
        serverPrivateKey.toPublicKey()
      );
      const sig = Signature.create(rngPrivateKey, [
        Field(3),
        Field(6),
        ...enc.cipherText,
      ]);
      diceRolls = EncrytpedAttackRoll.init(enc.publicKey, enc.cipherText, sig);

      const attackDistance = MELEE_ATTACK_RANGE + 5;

      expect(() => {
        Circuit.runAndCheck(() => {
          initialPhaseState.applyMeleeAttackAction(
            attack2,
            attack2.sign(player1PrivateKey),
            attackingPiece.clone(),
            targetPiece2.clone(),
            piecesTree.getWitness(attackingPiece.id.toBigInt()),
            piecesTree.getWitness(targetPiece2.id.toBigInt()),
            UInt32.from(attackDistance),
            diceRolls,
            serverPrivateKey
          );
        });
      }).toThrow();
    });

    it('attempts to spoof dice rolls', async () => {
      const actualRoll = Encryption.encrypt(
        [Field(1), Field(1), Field(6)],
        serverPrivateKey.toPublicKey()
      );

      const fakeRoll = Encryption.encrypt(
        [Field(6), Field(6), Field(1)],
        player1PrivateKey.toPublicKey()
      );

      let sig = Signature.create(player1PrivateKey, [
        Field(3),
        Field(6),
        ...fakeRoll.cipherText,
      ]);
      expect(() => {
        diceRolls = EncrytpedAttackRoll.init(
          fakeRoll.publicKey,
          fakeRoll.cipherText,
          sig
        );
      }).toThrow(); // signature matches data, but it uses the wrong signing key

      sig = Signature.create(rngPrivateKey, [
        Field(3),
        Field(6),
        ...actualRoll.cipherText,
      ]);
      expect(() => {
        diceRolls = EncrytpedAttackRoll.init(
          fakeRoll.publicKey,
          fakeRoll.cipherText,
          sig
        );
      }).toThrow(); // signature uses the right signing key, but does not match the data

      diceRolls = EncrytpedAttackRoll.init(
        actualRoll.publicKey,
        actualRoll.cipherText,
        sig
      );
      diceRolls.ciphertext = fakeRoll.cipherText; // trying to be sneaky

      const attackDistance = MELEE_ATTACK_RANGE - 5;

      expect(() => {
        Circuit.runAndCheck(() => {
          initialPhaseState.applyMeleeAttackAction(
            attack1,
            attack1.sign(player1PrivateKey),
            attackingPiece.clone(),
            targetPiece1.clone(),
            piecesTree.getWitness(attackingPiece.id.toBigInt()),
            piecesTree.getWitness(targetPiece1.id.toBigInt()),
            UInt32.from(attackDistance),
            diceRolls,
            serverPrivateKey
          );
        });
      }).toThrow();
    });
  });
});
