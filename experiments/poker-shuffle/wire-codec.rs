//! Evaluation adapter for ziffle f24f38e6 and 52 cards; not a live-game protocol.
//! Only unverified public values may be decoded. Proof contexts come from the
//! caller's independently agreed transcript, never from a received envelope.
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use ziffle::{
    AggregatePublicKey, MaskedDeck, OwnershipProof, PublicKey, RevealToken, RevealTokenProof,
    ShuffleProof, Verified,
};

#[derive(Debug, PartialEq, Eq)]
pub enum WireError {
    Length,
    Encoding,
    NonCanonical,
    Identity,
    Duplicate,
    Proof,
    Roster,
}

pub fn encode<T: CanonicalSerialize>(value: &T) -> Vec<u8> {
    let mut bytes = Vec::new();
    value
        .serialize_compressed(&mut bytes)
        .expect("serializing an in-memory value");
    bytes
}
fn decode<T: CanonicalDeserialize + CanonicalSerialize>(
    wire: &[u8],
    size: usize,
) -> Result<T, WireError> {
    if wire.len() != size {
        return Err(WireError::Length);
    }
    let mut remaining = wire;
    let value = T::deserialize_compressed(&mut remaining).map_err(|_| WireError::Encoding)?;
    if !remaining.is_empty() || encode(&value) != wire {
        return Err(WireError::NonCanonical);
    }
    Ok(value)
}
fn identity_encoding() -> Vec<u8> {
    encode(&ark_secp256k1::Affine::identity())
}

pub fn public_key(wire: &[u8]) -> Result<PublicKey, WireError> {
    let key = decode(wire, 33)?;
    if wire == identity_encoding() {
        return Err(WireError::Identity);
    }
    Ok(key)
}
pub fn ownership(wire: &[u8]) -> Result<OwnershipProof, WireError> {
    decode(wire, 65)
}
pub fn deck(wire: &[u8]) -> Result<MaskedDeck<52>, WireError> {
    decode(wire, 3432)
}
pub fn shuffle_proof(wire: &[u8]) -> Result<ShuffleProof<52>, WireError> {
    decode(wire, 5547)
}
pub fn reveal_token(wire: &[u8]) -> Result<RevealToken, WireError> {
    decode(wire, 33)
}
pub fn reveal_proof(wire: &[u8]) -> Result<RevealTokenProof, WireError> {
    decode(wire, 98)
}

/// Admit a fixed 2–5 seat roster using independently derived per-seat contexts.
/// No partially verified roster or host-supplied Verified label escapes on error.
pub fn admit_roster(
    entries: &[(&[u8], &[u8], &[u8])],
) -> Result<(Vec<Verified<PublicKey>>, AggregatePublicKey), WireError> {
    if !(2..=5).contains(&entries.len()) {
        return Err(WireError::Roster);
    }
    let mut seen = Vec::new();
    let mut verified = Vec::new();
    for &(key_wire, proof_wire, expected_context) in entries {
        let key = public_key(key_wire)?;
        if seen.contains(&key) {
            return Err(WireError::Duplicate);
        }
        let proof = ownership(proof_wire)?;
        verified.push(
            proof
                .verify(key, expected_context)
                .ok_or(WireError::Proof)?,
        );
        seen.push(key);
    }
    let aggregate = AggregatePublicKey::new(&verified);
    if encode(&aggregate) == identity_encoding() {
        return Err(WireError::Identity);
    }
    Ok((verified, aggregate))
}
