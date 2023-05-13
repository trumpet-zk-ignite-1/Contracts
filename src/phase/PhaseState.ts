import {
  Field,
  Struct,
  Signature,
  PublicKey,
  UInt32,
  PrivateKey,
  Circuit,
  Bool,
} from 'snarkyjs';

import { GameState } from '../game/GameState';
import { Piece } from '../objects/Piece';
import { Position } from '../objects/Position';
import { Action } from '../objects/Action';
import { ArenaMerkleWitness } from '../objects/ArenaMerkleTree';
import { PiecesMerkleWitness } from '../objects/PiecesMerkleTree';
import { EncrytpedAttackRoll } from '../objects/AttackDiceRolls';

export class PhaseState extends Struct({
  nonce: Field,
  actionsNonce: Field, // nonce of actions processed so far
  startingPiecesState: Field, // Pieces state before this turn
  currentPiecesState: Field, // Pieces state after the actions applied in this turn
  startingArenaState: Field, // Arena state before this turn
  currentArenaState: Field, // Arena state after the actions applied in this turn
  playerPublicKey: PublicKey, // the player this turn is for
}) {
  constructor(
    nonce: Field,
    actionsNonce: Field,
    startingPiecesState: Field,
    currentPiecesState: Field,
    startingArenaState: Field,
    currentArenaState: Field,
    playerPublicKey: PublicKey
  ) {
    super({
      nonce,
      actionsNonce,
      startingPiecesState,
      currentPiecesState,
      startingArenaState,
      currentArenaState,
      playerPublicKey,
    });
  }

  static init(
    startingPiecesState: Field,
    startingArenaState: Field,
    playerPublicKey: PublicKey
  ): PhaseState {
    return new PhaseState(
      Field(0),
      Field(0),
      startingPiecesState,
      startingPiecesState,
      startingArenaState,
      startingArenaState,
      playerPublicKey
    );
  }

  applyMoveAction(
    action: Action,
    actionSignature: Signature,
    piece: Piece,
    pieceWitness: PiecesMerkleWitness,
    oldPositionArenaWitness: ArenaMerkleWitness,
    newPositionArenaWitness: ArenaMerkleWitness,
    newPosition: Position,
    assertedMoveDistance: UInt32
  ): PhaseState {
    this.playerPublicKey.assertEquals(piece.playerPublicKey);
    piece.position
      .verifyDistance(newPosition, assertedMoveDistance)
      .assertTrue();
    assertedMoveDistance.assertLessThanOrEqual(piece.condition.movement);
    const v = actionSignature.verify(
      this.playerPublicKey,
      action.signatureArguments()
    );
    v.assertTrue();
    action.nonce.assertGreaterThan(this.actionsNonce);
    action.actionType.assertEquals(Field(0)); // action is a "move" action
    action.actionParams.assertEquals(newPosition.hash());

    let proot = pieceWitness.calculateRoot(piece.hash());
    let pkey = pieceWitness.calculateIndex();
    proot.assertEquals(this.currentPiecesState);
    pkey.assertEquals(piece.id);

    let oldAroot: Field;
    let midAroot: Field;
    let newAroot: Field;
    let oldAkey: Field;
    let newAkey: Field;

    // Old Witness, old position is occupied
    oldAroot = oldPositionArenaWitness.calculateRoot(Field(1));
    oldAkey = oldPositionArenaWitness.calculateIndex();
    oldAroot.assertEquals(this.currentArenaState);
    oldAkey.assertEquals(Field(piece.position.getMerkleKey(800)));

    // Old Witness, new position is un-occupied
    midAroot = newPositionArenaWitness.calculateRoot(Field(0));
    newAkey = newPositionArenaWitness.calculateIndex();
    // assert that the mid tree with new position un-occupied == the old tree with the old position un-occupied
    // e.g. every other leaf must be the same; they are the same tree outside of these 2 leaves
    midAroot.assertEquals(oldPositionArenaWitness.calculateRoot(Field(0)));
    newAkey.assertEquals(Field(newPosition.getMerkleKey(800)));

    // calculate new tree root based on the new position being occupied, this is the new root of the arena
    newAroot = newPositionArenaWitness.calculateRoot(Field(1));

    const endingPiece = piece.clone();
    endingPiece.position = newPosition;
    proot = pieceWitness.calculateRoot(endingPiece.hash());

    return new PhaseState(
      this.nonce,
      action.nonce,
      this.startingPiecesState,
      proot,
      this.startingArenaState,
      newAroot,
      this.playerPublicKey
    );
  }

  // Todo: currently not validating the pieces belong in the game
  applyRangedAttackAction(
    action: Action,
    actionSignature: Signature,
    piece: Piece,
    otherPiece: Piece,
    assertedAttackDistance: UInt32,
    attackRoll: EncrytpedAttackRoll,
    serverSecretKey: PrivateKey
  ): PhaseState {
    this.playerPublicKey.assertEquals(piece.playerPublicKey);
    piece.position
      .verifyDistance(otherPiece.position, assertedAttackDistance)
      .assertTrue();
    assertedAttackDistance.assertLessThanOrEqual(
      piece.condition.rangedAttackRange
    );
    const v = actionSignature.verify(
      this.playerPublicKey,
      action.signatureArguments()
    );
    v.assertTrue();

    action.nonce.assertGreaterThan(this.actionsNonce);
    action.actionType.assertEquals(Field(1)); // action is a "ranged attack" action
    action.actionParams.assertEquals(otherPiece.hash());

    const decrytpedRolls = attackRoll.decryptRoll(serverSecretKey);
    // roll for hit
    const hit = Circuit.if(
      decrytpedRolls.hit.greaterThanOrEqual(piece.condition.hitRoll.value),
      Bool(true),
      Bool(false)
    );

    // roll for wound
    const wound = Circuit.if(hit, Bool(true), Bool(false));

    // roll for save
    const save = Circuit.if(wound, Bool(false), Bool(false));

    let healthDiff = Circuit.if(wound, UInt32.from(2), UInt32.from(0));

    const newHealth = Circuit.if(
      healthDiff.greaterThanOrEqual(otherPiece.condition.health),
      UInt32.from(0),
      otherPiece.condition.health.sub(healthDiff)
    );

    otherPiece.condition.health = newHealth;

    return new PhaseState(
      this.nonce,
      action.nonce,
      this.startingPiecesState,
      this.currentPiecesState,
      this.startingArenaState,
      this.currentArenaState,
      this.playerPublicKey
    );
  }

  toJSON() {
    return {
      nonce: Number(this.nonce.toString()),
      actionsNonce: Number(this.actionsNonce.toString()),
      startingPiecesState: this.startingPiecesState.toString(),
      currentPiecesState: this.currentPiecesState.toString(),
      startingArenaState: this.startingArenaState.toString(),
      currentArenaState: this.currentArenaState.toString(),
      playerPublicKey: this.playerPublicKey.toBase58(),
    };
  }
}
