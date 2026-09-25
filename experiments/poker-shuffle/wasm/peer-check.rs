//! Isolated one-seat worker experiment. Canonical private-hole policy; flop release requires the trusted adapter's committed checkpoint.
//! No production enrollment, key recovery, settlement or network protocol.
#[path = "wire-codec.rs"]
mod wire;
use rand_core::SeedableRng;
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use ziffle::{
    AggregatePublicKey, AggregateRevealToken, MaskedDeck, PublicKey, RevealToken, SecretKey,
    Shuffle, Verified,
};

struct Peer {
    session: [u8; 32],
    head: [u8; 32],
    seats: usize,
    seat: usize,
    dealer: usize,
    rng: rand_chacha::ChaCha20Rng,
    secret: SecretKey,
    public: PublicKey,
    own_announcement: Vec<u8>,
    announcements: Vec<Option<Vec<u8>>>,
    keys: Vec<Verified<PublicKey>>,
    aggregate: Option<AggregatePublicKey>,
    deck: Option<Verified<MaskedDeck<52>>>,
    step: usize,
    tokens: Vec<Vec<Option<Verified<RevealToken>>>>,
    public_head: Option<[u8; 32]>,
    next_public_stage: usize,
    public_opened: Vec<bool>,
    showdown_mask: usize,
    public_tokens: Vec<Vec<Option<Verified<RevealToken>>>>,
}
thread_local! {
    static PEER: RefCell<Option<Peer>> = const { RefCell::new(None) };
    static INPUT: RefCell<[u8; 10000]> = const { RefCell::new([0; 10000]) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}
// Fixed-width fields and distinct tags prevent ambiguous context concatenation.
fn context(
    session: &[u8; 32],
    stage: &[u8],
    seats: usize,
    seat: usize,
    parent: &[u8; 32],
) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"manamesh-shuffle-worker-context/v7");
    hash.update(session);
    hash.update([stage.len() as u8]);
    hash.update(stage);
    hash.update([seats as u8, seat as u8]);
    hash.update(parent);
    hash.finalize().into()
}
fn key_context(session: &[u8; 32], seats: usize, seat: usize) -> [u8; 32] {
    context(session, b"key", seats, seat, &[0; 32])
}
fn shuffle_context(peer: &Peer, step: usize) -> [u8; 32] {
    context(&peer.session, b"shuffle", peer.seats, step, &peer.head)
}
fn hole_owner(peer: &Peer, position: usize) -> Result<usize, ()> {
    if position >= 2 * peer.seats { return Err(()); }
    Ok((peer.dealer + 1 + position % peer.seats) % peer.seats)
}
fn reveal_context(peer: &Peer, position: usize, seat: usize) -> [u8; 32] {
    // Position and owner are fixed-width fields, never host-supplied role labels.
    let stage = [b'h', position as u8, hole_owner(peer, position).unwrap() as u8];
    context(&peer.session, &stage, peer.seats, seat, &peer.head)
}
fn input(len: usize) -> Result<Vec<u8>, ()> {
    if len > 10000 {
        return Err(());
    }
    Ok(INPUT.with(|data| data.borrow()[..len].to_vec()))
}
fn operate(f: impl FnOnce(&mut Peer) -> Result<Vec<u8>, ()>) -> u32 {
    OUTPUT.with(|output| output.borrow_mut().clear());
    let result = PEER.with(|peer| {
        let mut peer = peer.borrow_mut();
        f(peer.as_mut().ok_or(())?)
    });
    match result {
        Ok(bytes) => {
            OUTPUT.with(|output| *output.borrow_mut() = bytes);
            0
        }
        Err(()) => 1,
    }
}
#[unsafe(no_mangle)]
pub extern "C" fn input_ptr() -> *mut u8 {
    INPUT.with(|data| data.borrow_mut().as_mut_ptr())
}
#[unsafe(no_mangle)]
pub extern "C" fn output_ptr() -> *const u8 {
    OUTPUT.with(|data| data.borrow().as_ptr())
}
#[unsafe(no_mangle)]
pub extern "C" fn output_len() -> usize {
    OUTPUT.with(|data| data.borrow().len())
}

#[unsafe(no_mangle)]
pub extern "C" fn initialize(
    seats: usize,
    seat: usize,
    dealer: usize,
    session_len: usize,
    a: u32,
    b: u32,
    c: u32,
    d: u32,
    e: u32,
    f: u32,
    g: u32,
    h: u32,
) -> u32 {
    if !(2..=5).contains(&seats) || seat >= seats || dealer >= seats || PEER.with(|peer| peer.borrow().is_some()) {
        return 1;
    }
    let session: [u8; 32] = match input(session_len)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
    {
        Some(session) if session != [0; 32] => session,
        _ => return 1,
    };
    // Every proof and transcript inherits the locally agreed deal policy.
    let mut binding = Sha256::new();
    binding.update(b"manamesh-shuffle-worker-deal/v7");
    binding.update(session);
    binding.update([seats as u8, dealer as u8]);
    let session: [u8; 32] = binding.finalize().into();
    let mut seed = [0; 32];
    for (i, word) in [a, b, c, d, e, f, g, h].iter().enumerate() {
        seed[i * 4..i * 4 + 4].copy_from_slice(&word.to_le_bytes());
    }
    let mut rng = rand_chacha::ChaCha20Rng::from_seed(seed);
    let (secret, public, proof) =
        Shuffle::<52>::default().keygen(&mut rng, key_context(&session, seats, seat).as_slice());
    let mut announcement = wire::encode(&public);
    announcement.extend(wire::encode(&proof));
    OUTPUT.with(|output| *output.borrow_mut() = announcement.clone());
    PEER.with(|peer| {
        *peer.borrow_mut() = Some(Peer {
            session,
            head: [0; 32],
            seats,
            seat,
            dealer,
            rng,
            secret,
            public,
            own_announcement: announcement,
            announcements: vec![None; seats],
            keys: Vec::new(),
            aggregate: None,
            deck: None,
            step: 0,
            tokens: vec![vec![None; seats]; 2 * seats],
            public_head: None,
            public_tokens: vec![vec![None; seats]; 5 + 2 * seats],
            next_public_stage: 0,
            public_opened: vec![false; 5 + 2 * seats],
            showdown_mask: 0,
        })
    });
    0
}
#[unsafe(no_mangle)]
pub extern "C" fn admit(seat: usize, len: usize) -> u32 {
    operate(|peer| {
        let bytes = input(len)?;
        if seat >= peer.seats || bytes.len() != 98 || peer.announcements[seat].is_some() {
            return Err(());
        }
        if seat == peer.seat && bytes != peer.own_announcement {
            return Err(());
        }
        let key = wire::public_key(&bytes[..33]).map_err(|_| ())?;
        let proof = wire::ownership(&bytes[33..]).map_err(|_| ())?;
        proof
            .verify(key, key_context(&peer.session, peer.seats, seat).as_slice())
            .ok_or(())?;
        if peer
            .announcements
            .iter()
            .flatten()
            .any(|other| other[..33] == bytes[..33])
        {
            return Err(());
        }
        let mut proposed = peer.announcements.clone();
        proposed[seat] = Some(bytes);
        if proposed.iter().all(Option::is_some) {
            let contexts: Vec<_> = (0..peer.seats)
                .map(|seat| key_context(&peer.session, peer.seats, seat))
                .collect();
            let entries: Vec<_> = proposed
                .iter()
                .enumerate()
                .map(|(seat, data)| {
                    let data = data.as_ref().unwrap();
                    (&data[..33], &data[33..], contexts[seat].as_slice())
                })
                .collect();
            let (keys, aggregate) = wire::admit_roster(&entries).map_err(|_| ())?;
            let mut hash = Sha256::new();
            hash.update(b"manamesh-shuffle-worker-roster/v7");
            hash.update(peer.session);
            hash.update([peer.seats as u8]);
            for entry in proposed.iter().flatten() {
                hash.update(entry);
            }
            peer.head = hash.finalize().into();
            peer.keys = keys;
            peer.aggregate = Some(aggregate);
        }
        peer.announcements = proposed;
        Ok(Vec::new())
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn make_shuffle() -> u32 {
    operate(|peer| {
        if peer.step != peer.seat {
            return Err(());
        }
        let aggregate = peer.aggregate.ok_or(())?;
        let shuffle = Shuffle::<52>::default();
        let ctx = shuffle_context(peer, peer.step);
        let (deck, proof) = match &peer.deck {
            None => shuffle.shuffle_initial_deck(&mut peer.rng, aggregate, ctx.as_slice()),
            Some(previous) => {
                shuffle.shuffle_deck(&mut peer.rng, aggregate, previous, ctx.as_slice())
            }
        };
        let mut out = wire::encode(&deck);
        out.extend(wire::encode(&proof));
        // The creator verifies the same serialized public bytes as every peer.
        accept_shuffle(peer, peer.step, &out)?;
        Ok(out)
    })
}
fn accept_shuffle(peer: &mut Peer, step: usize, bytes: &[u8]) -> Result<(), ()> {
    if step != peer.step || step >= peer.seats || bytes.len() != 8979 {
        return Err(());
    }
    let aggregate = peer.aggregate.ok_or(())?;
    let deck = wire::deck(&bytes[..3432]).map_err(|_| ())?;
    let proof = wire::shuffle_proof(&bytes[3432..]).map_err(|_| ())?;
    let shuffle = Shuffle::<52>::default();
    let ctx = shuffle_context(peer, step);
    let verified = match &peer.deck {
        None => shuffle.verify_initial_shuffle(aggregate, deck, proof, ctx.as_slice()),
        Some(previous) => shuffle.verify_shuffle(aggregate, previous, deck, proof, ctx.as_slice()),
    }
    .ok_or(())?;
    let mut hash = Sha256::new();
    hash.update(b"manamesh-shuffle-worker-step/v7");
    hash.update(peer.head);
    hash.update([step as u8]);
    hash.update(bytes);
    peer.head = hash.finalize().into();
    peer.deck = Some(verified);
    peer.step += 1;
    Ok(())
}
#[unsafe(no_mangle)]
pub extern "C" fn receive_shuffle(step: usize, len: usize) -> u32 {
    operate(|peer| {
        accept_shuffle(peer, step, &input(len)?)?;
        Ok(Vec::new())
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn make_token(position: usize) -> u32 {
    operate(|peer| {
        // Never export the owner's final contribution, including on host request.
        if peer.step != peer.seats || peer.seat == hole_owner(peer, position)? {
            return Err(());
        }
        let card = peer.deck.as_ref().ok_or(())?.get(position).ok_or(())?;
        let ctx = reveal_context(peer, position, peer.seat);
        let (token, proof) =
            card.reveal_token(&mut peer.rng, &peer.secret, peer.public, ctx.as_slice());
        let mut out = wire::encode(&token);
        out.extend(wire::encode(&proof));
        Ok(out)
    })
}
fn verify_private_token(peer: &Peer, position: usize, seat: usize, bytes: &[u8]) -> Result<Verified<RevealToken>, ()> {
    let owner = hole_owner(peer, position)?;
    if peer.step != peer.seats || seat >= peer.seats || seat == owner || bytes.len() != 131 {
        return Err(());
    }
    let card = peer.deck.as_ref().ok_or(())?.get(position).ok_or(())?;
    let token = wire::reveal_token(&bytes[..33]).map_err(|_| ())?;
    let proof = wire::reveal_proof(&bytes[33..]).map_err(|_| ())?;
    proof.verify(peer.keys[seat], token, card, reveal_context(peer, position, seat).as_slice()).ok_or(())
}
/// Public proof review only: no token retention, opening or secret-key operation.
#[unsafe(no_mangle)]
pub extern "C" fn review_token(position: usize, seat: usize, len: usize) -> u32 {
    operate(|peer| {
        let bytes = input(len)?;
        verify_private_token(peer, position, seat, &bytes)?;
        Ok(Vec::new())
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn receive_token(position: usize, seat: usize, len: usize) -> u32 {
    operate(|peer| {
        let bytes = input(len)?;
        if peer.seat != hole_owner(peer, position)? || seat >= peer.seats || peer.tokens[position][seat].is_some() {
            return Err(());
        }
        let verified = verify_private_token(peer, position, seat, &bytes)?;
        peer.tokens[position][seat] = Some(verified);
        Ok(Vec::new())
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn open_private_card(position: usize) -> u32 {
    operate(|peer| {
        if peer.seat != hole_owner(peer, position)? || peer.step != peer.seats
            || peer.tokens[position].iter().enumerate().any(|(seat, token)| seat != peer.seat && token.is_none())
        {
            return Err(());
        }
        let card = peer.deck.as_ref().ok_or(())?.get(position).ok_or(())?;
        let ctx = reveal_context(peer, position, peer.seat);
        let (token, proof) =
            card.reveal_token(&mut peer.rng, &peer.secret, peer.public, ctx.as_slice());
        let mut tokens = vec![
            proof
                .verify(peer.keys[peer.seat], token, card, ctx.as_slice())
                .ok_or(())?,
        ];
        tokens.extend(peer.tokens[position].iter().enumerate().filter(|(seat, _)| *seat != peer.seat).map(|(_, token)| token.unwrap()));
        let index = Shuffle::<52>::default()
            .reveal_card(AggregateRevealToken::new(&tokens), card)
            .ok_or(())?;
        Ok(vec![index as u8])
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn checkpoint_digest() -> u32 {
    operate(|peer| {
        peer.aggregate.ok_or(())?;
        Ok(peer.head.to_vec())
    })
}

// The native worker does not parse Poker history. Its private adapter must derive
// this permission from a locally committed, complete, contested betting round.
fn public_index(peer: &Peer, position: usize) -> Result<usize, ()> {
    peer.public_head.ok_or(())?;
    let offset = 2 * peer.seats;
    match peer.next_public_stage - 1 {
        0 if position > offset && position <= offset + 3 => Ok(position - offset - 1),
        1 if position == offset + 5 => Ok(3),
        2 if position == offset + 7 => Ok(4),
        3 if position < offset => {
            let owner = hole_owner(peer, position)?;
            if peer.showdown_mask & (1 << owner) != 0 { Ok(5 + position) } else { Err(()) }
        },
        _ => Err(()),
    }
}
fn public_context(peer: &Peer, position: usize, seat: usize) -> Result<[u8; 32], ()> {
    public_index(peer, position)?;
    let mut parent = Sha256::new();
    parent.update(b"manamesh-shuffle-public-street/v7");
    parent.update(peer.head);
    parent.update(peer.public_head.ok_or(())?);
    parent.update((peer.showdown_mask as u16).to_le_bytes());
    Ok(context(&peer.session, &[b'p', position as u8], peer.seats, seat, &parent.finalize().into()))
}
#[unsafe(no_mangle)]
pub extern "C" fn authorize_street(stage: usize, len: usize) -> u32 {
    operate(|peer| {
        if peer.step != peer.seats || stage != peer.next_public_stage || stage >= 3 { return Err(()); }
        if stage == 1 && !peer.public_opened[..3].iter().all(|opened| *opened) { return Err(()); }
        if stage == 2 && !peer.public_opened[3] { return Err(()); }
        let head: [u8; 32] = input(len)?.try_into().map_err(|_| ())?;
        if head == [0; 32] || peer.public_head == Some(head) { return Err(()); }
        peer.public_head = Some(head);
        peer.next_public_stage += 1;
        Ok(Vec::new())
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn make_public_token(position: usize) -> u32 {
    operate(|peer| {
        let index = public_index(peer, position)?;
        let card = peer.deck.as_ref().ok_or(())?.get(position).ok_or(())?;
        let ctx = public_context(peer, position, peer.seat)?;
        let (token, proof) = card.reveal_token(&mut peer.rng, &peer.secret, peer.public, ctx.as_slice());
        let verified = proof.verify(peer.keys[peer.seat], token, card, ctx.as_slice()).ok_or(())?;
        let mut out = wire::encode(&token); out.extend(wire::encode(&proof));
        peer.public_tokens[index][peer.seat] = Some(verified);
        Ok(out)
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn receive_public_token(position: usize, seat: usize, len: usize) -> u32 {
    operate(|peer| {
        let index = public_index(peer, position)?;
        if seat >= peer.seats || seat == peer.seat || peer.public_tokens[index][seat].is_some() || len != 131 { return Err(()); }
        let bytes = input(len)?;
        let card = peer.deck.as_ref().ok_or(())?.get(position).ok_or(())?;
        let token = wire::reveal_token(&bytes[..33]).map_err(|_| ())?;
        let proof = wire::reveal_proof(&bytes[33..]).map_err(|_| ())?;
        let verified = proof.verify(peer.keys[seat], token, card, public_context(peer, position, seat)?.as_slice()).ok_or(())?;
        peer.public_tokens[index][seat] = Some(verified);
        Ok(Vec::new())
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn open_public_card(position: usize) -> u32 {
    operate(|peer| {
        let index = public_index(peer, position)?;
        if peer.public_tokens[index].iter().any(Option::is_none) { return Err(()); }
        let card = peer.deck.as_ref().ok_or(())?.get(position).ok_or(())?;
        let tokens: Vec<_> = peer.public_tokens[index].iter().map(|token| token.unwrap()).collect();
        let card_index = Shuffle::<52>::default().reveal_card(AggregateRevealToken::new(&tokens), card).ok_or(())?;
        peer.public_opened[index] = true;
        Ok(vec![card_index as u8])
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn authorize_showdown(mask: usize, len: usize) -> u32 {
    operate(|peer| {
        if peer.next_public_stage != 3 || !peer.public_opened[..5].iter().all(|opened| *opened)
            || mask >= (1 << peer.seats) || mask.count_ones() < 2 { return Err(()); }
        let head: [u8; 32] = input(len)?.try_into().map_err(|_| ())?;
        if head == [0; 32] || peer.public_head == Some(head) { return Err(()); }
        peer.showdown_mask = mask;
        peer.public_head = Some(head);
        peer.next_public_stage = 4;
        Ok(Vec::new())
    })
}
