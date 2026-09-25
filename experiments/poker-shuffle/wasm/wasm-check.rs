// Evaluation-only raw WASM entry; build with the manifest described in README.md.
// This uses its public API unchanged; it is not the Poker production protocol.
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use rand_core::SeedableRng;
use std::collections::BTreeSet;
use ziffle::{AggregatePublicKey, AggregateRevealToken, MaskedDeck, Shuffle, ShuffleProof};

fn bytes<T: CanonicalSerialize>(value: &T) -> Vec<u8> {
    let mut out = Vec::new();
    value.serialize_compressed(&mut out).unwrap();
    out
}

fn proof(encoded: &[u8]) -> ShuffleProof<52> {
    ShuffleProof::deserialize_compressed(encoded).unwrap()
}

// Ephemeral test seed from crypto.getRandomValues inside the browser worker.
// No production key API or persistent key material is exposed.
#[unsafe(no_mangle)]
pub extern "C" fn run_checks(
    seats: usize,
    a: u32,
    b: u32,
    c: u32,
    d: u32,
    e: u32,
    f: u32,
    g: u32,
    h: u32,
) -> u32 {
    assert!((2..=5).contains(&seats));
    let mut seed = [0u8; 32];
    for (i, value) in [a, b, c, d, e, f, g, h].into_iter().enumerate() {
        seed[i * 4..i * 4 + 4].copy_from_slice(&value.to_le_bytes());
    }
    let mut rng = rand_chacha::ChaCha20Rng::from_seed(seed);
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
    let (first, first_proof) = shuffle.shuffle_initial_deck(&mut rng, apk, ctx);
    let first_encoded = bytes(&first_proof);
    assert!(shuffle
        .verify_initial_shuffle(apk, first, proof(&first_encoded), b"other-session")
        .is_none());
    let mut verified = shuffle
        .verify_initial_shuffle(apk, first, first_proof, ctx)
        .unwrap();
    let initial_verified = verified;
    for round in 1..seats {
        let round_context = format!("{context}/shuffle/{round}");
        let round_ctx = round_context.as_bytes();
        let (next, next_proof) = shuffle.shuffle_deck(&mut rng, apk, &verified, round_ctx);
        let encoded = bytes(&next_proof);
        let mut tampered = bytes(&next);
        // Replace card 1 with card 0: all points still decode, but this is no permutation.
        let card_bytes = tampered.len() / 52;
        let duplicate = tampered[..card_bytes].to_vec();
        tampered[card_bytes..2 * card_bytes].copy_from_slice(&duplicate);
        let duplicate_deck = MaskedDeck::<52>::deserialize_compressed(tampered.as_slice()).unwrap();
        assert!(shuffle
            .verify_shuffle(apk, &verified, duplicate_deck, proof(&encoded), round_ctx)
            .is_none());
        assert!(shuffle
            .verify_shuffle(apk, &verified, next, proof(&encoded), b"other-session")
            .is_none());
        if round > 1 {
            assert!(shuffle
                .verify_shuffle(apk, &initial_verified, next, proof(&encoded), round_ctx)
                .is_none());
        }
        let next_verified = shuffle
            .verify_shuffle(apk, &verified, next, next_proof, round_ctx)
            .unwrap();
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
                assert!(token_proof
                    .verify(*vpk, token, card, b"other-request")
                    .is_none());
                assert!(token_proof
                    .verify(
                        *vpk,
                        token,
                        verified.get((position + 1) % 52).unwrap(),
                        reveal_ctx.as_bytes()
                    )
                    .is_none());
                token_proof
                    .verify(*vpk, token, card, reveal_ctx.as_bytes())
                    .unwrap()
            })
            .collect();
        // Owner's final token stays local. Every proper prefix lacks at least one seat.
        for count in 0..seats {
            assert!(shuffle
                .reveal_card(AggregateRevealToken::new(&tokens[..count]), card)
                .is_none());
        }
        revealed.insert(
            shuffle
                .reveal_card(AggregateRevealToken::new(&tokens), card)
                .unwrap(),
        );
    }
    assert_eq!(revealed, (0..52).collect());
    52
}
