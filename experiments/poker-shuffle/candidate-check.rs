// Evaluation only. Run as an example in the pinned ziffle source tree.
// This uses its public API unchanged; it is not the Poker production protocol.
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use std::{collections::BTreeSet, time::Instant};
use ziffle::{AggregatePublicKey, AggregateRevealToken, MaskedDeck, Shuffle, ShuffleProof};

fn bytes<T: CanonicalSerialize>(value: &T) -> Vec<u8> {
    let mut out = Vec::new();
    value.serialize_compressed(&mut out).unwrap();
    out
}

fn proof(encoded: &[u8]) -> ShuffleProof<52> {
    ShuffleProof::deserialize_compressed(encoded).unwrap()
}

fn main() {
    for seats in 2..=5 {
        let mut rng = rand::thread_rng();
        let shuffle = Shuffle::<52>::default();
        let context = format!("manamesh-candidate-check/v1/seats/{seats}");
        let ctx = context.as_bytes();
        let keys: Vec<_> = (0..seats)
            .map(|_| {
                let (sk, pk, ownership) = shuffle.keygen(&mut rng, ctx);
                assert!(ownership.verify(pk, b"other-session").is_none());
                let verified = ownership.verify(pk, ctx).unwrap();
                (sk, pk, verified)
            })
            .collect();
        let apk = AggregatePublicKey::new(&keys.iter().map(|k| k.2).collect::<Vec<_>>());
        let start = Instant::now();
        let (first, first_proof) = shuffle.shuffle_initial_deck(&mut rng, apk, ctx);
        let first_encoded = bytes(&first_proof);
        assert!(
            shuffle
                .verify_initial_shuffle(apk, first, proof(&first_encoded), b"other-session")
                .is_none()
        );
        let mut verified = shuffle
            .verify_initial_shuffle(apk, first, first_proof, ctx)
            .unwrap();
        let initial_verified = verified;
        let mut prove_ms = start.elapsed().as_millis();
        let mut verify_ms = 0;
        for round in 1..seats {
            let round_context = format!("{context}/shuffle/{round}");
            let round_ctx = round_context.as_bytes();
            let start = Instant::now();
            let (next, next_proof) = shuffle.shuffle_deck(&mut rng, apk, &verified, round_ctx);
            prove_ms += start.elapsed().as_millis();
            let encoded = bytes(&next_proof);
            let mut tampered = bytes(&next);
            // Replace card 1 with card 0: all points still decode, but this is no permutation.
            let card_bytes = tampered.len() / 52;
            let duplicate = tampered[..card_bytes].to_vec();
            tampered[card_bytes..2 * card_bytes].copy_from_slice(&duplicate);
            let duplicate_deck =
                MaskedDeck::<52>::deserialize_compressed(tampered.as_slice()).unwrap();
            assert!(
                shuffle
                    .verify_shuffle(apk, &verified, duplicate_deck, proof(&encoded), round_ctx)
                    .is_none()
            );
            assert!(
                shuffle
                    .verify_shuffle(apk, &verified, next, proof(&encoded), b"other-session")
                    .is_none()
            );
            if round > 1 {
                assert!(
                    shuffle
                        .verify_shuffle(apk, &initial_verified, next, proof(&encoded), round_ctx)
                        .is_none()
                );
            }
            let start = Instant::now();
            let next_verified = shuffle
                .verify_shuffle(apk, &verified, next, next_proof, round_ctx)
                .unwrap();
            verify_ms += start.elapsed().as_millis();
            // The equality attack that succeeds against existing Poker must fail here.
            for i in 0..52 {
                assert!((0..52).all(|j| verified.get(i) != next_verified.get(j)));
            }
            verified = next_verified;
        }
        let mut revealed = BTreeSet::new();
        for position in 0..52 {
            let card = verified.get(position).unwrap();
            let reveal_ctx = format!("{context}/reveal/{position}");
            let tokens: Vec<_> = keys
                .iter()
                .map(|(sk, pk, vpk)| {
                    let (token, token_proof) =
                        card.reveal_token(&mut rng, sk, *pk, reveal_ctx.as_bytes());
                    assert!(
                        token_proof
                            .verify(*vpk, token, card, b"other-request")
                            .is_none()
                    );
                    assert!(
                        token_proof
                            .verify(
                                *vpk,
                                token,
                                verified.get((position + 1) % 52).unwrap(),
                                reveal_ctx.as_bytes()
                            )
                            .is_none()
                    );
                    token_proof
                        .verify(*vpk, token, card, reveal_ctx.as_bytes())
                        .unwrap()
                })
                .collect();
            // Owner's final token stays local. Every proper prefix lacks at least one seat.
            for count in 0..seats {
                assert!(
                    shuffle
                        .reveal_card(AggregateRevealToken::new(&tokens[..count]), card)
                        .is_none()
                );
            }
            revealed.insert(
                shuffle
                    .reveal_card(AggregateRevealToken::new(&tokens), card)
                    .unwrap(),
            );
        }
        assert_eq!(revealed, (0..52).collect());
        println!(
            "seats={seats} checks=passed deck_bytes={} proof_bytes={} setup_and_prove_ms={prove_ms} subsequent_verify_ms={verify_ms}",
            bytes(&first).len(),
            first_encoded.len()
        );
    }
}
