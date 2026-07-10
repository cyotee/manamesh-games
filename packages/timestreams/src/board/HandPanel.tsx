/**
 * Player hand panel: local group / sort / drag-reorder.
 * Layout state is client-only (P2P-safe); play still uses instance card ids.
 */

import React from "react";
import type { TimestreamsCard } from "../types";
import { canPlayCard } from "../effects/gates";
import type { TimestreamsState } from "../types";
import {
  repairHandOrder,
  ensureContiguousGroups,
  buildGroups,
  sortHandIds,
  reorderIds,
  reorderGroups,
  cardsByIdMap,
  loadHandPrefs,
  saveHandPrefs,
  type SortKey,
  type SortDir,
  type HandGroup,
} from "./handLayout";

export interface HandPanelProps {
  G: TimestreamsState;
  playerID: string | null;
  myHand: TimestreamsCard[];
  isMyTurn: boolean;
  isPlayPhase: boolean;
  isSetupPhase: boolean;
  isCryptoPhase: boolean;
  currentPlayer: string | undefined;
  activePrompt: boolean;
  onPlayInvention: (cardId: string) => void;
  onPlayAction: (cardId: string) => void;
  onPass: () => void;
  onCardHover: (card: TimestreamsCard | null) => void;
}

function handSignature(hand: TimestreamsCard[]): string {
  return hand.map((c) => c.id).join("|");
}

export const HandPanel: React.FC<HandPanelProps> = ({
  G,
  playerID,
  myHand,
  isMyTurn,
  isPlayPhase,
  isSetupPhase,
  isCryptoPhase,
  currentPlayer,
  activePrompt,
  onPlayInvention,
  onPlayAction,
  onPass,
  onCardHover,
}) => {
  const prefsInit = React.useMemo(() => loadHandPrefs(playerID), [playerID]);
  const [groupEnabled, setGroupEnabled] = React.useState(prefsInit.group);
  const [sortKey, setSortKey] = React.useState<SortKey>(prefsInit.sortKey);
  const [sortDir, setSortDir] = React.useState<SortDir>(prefsInit.sortDir);
  const [handOrder, setHandOrder] = React.useState<string[]>(() =>
    myHand.map((c) => c.id),
  );
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [dragMode, setDragMode] = React.useState<"card" | "group" | null>(null);

  // Persist prefs (not full order)
  React.useEffect(() => {
    saveHandPrefs(playerID, {
      group: groupEnabled,
      sortKey,
      sortDir,
    });
  }, [playerID, groupEnabled, sortKey, sortDir]);

  // Repair order + optional re-sort when hand membership changes
  React.useEffect(() => {
    const ids = myHand.map((c) => c.id);
    const byId = cardsByIdMap(myHand);
    setHandOrder((prev) => {
      let next = repairHandOrder(prev, ids);
      if (sortKey !== "custom") {
        next = sortHandIds(next, byId, sortKey, sortDir);
      } else if (groupEnabled) {
        next = ensureContiguousGroups(next, byId);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when membership changes
  }, [handSignature(myHand)]);

  const byId = React.useMemo(() => cardsByIdMap(myHand), [myHand]);

  const orderedCards: TimestreamsCard[] = React.useMemo(() => {
    return handOrder
      .map((id) => myHand.find((c) => c.id === id))
      .filter((c): c is TimestreamsCard => !!c);
  }, [handOrder, myHand]);

  const groups: HandGroup[] = React.useMemo(() => {
    if (!groupEnabled) return [];
    return buildGroups(handOrder, byId);
  }, [groupEnabled, handOrder, byId]);

  const applySort = (key: SortKey, dir: SortDir = sortDir) => {
    setSortKey(key);
    setSortDir(dir);
    if (key === "custom") return;
    setHandOrder((prev) => sortHandIds(prev, byId, key, dir));
  };

  const toggleGroup = (on: boolean) => {
    setGroupEnabled(on);
    if (on) {
      setHandOrder((prev) => ensureContiguousGroups(prev, byId));
    }
  };

  const onDragStartCard = (index: number) => (e: React.DragEvent) => {
    setDragIndex(index);
    setDragMode(groupEnabled ? "group" : "card");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onDropAt = (toIndex: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const from =
      dragIndex !== null
        ? dragIndex
        : parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (Number.isNaN(from)) {
      setDragIndex(null);
      setDragMode(null);
      return;
    }
    if (groupEnabled && dragMode === "group") {
      const g = buildGroups(handOrder, byId);
      setHandOrder(reorderGroups(g, from, toIndex));
    } else {
      setHandOrder((prev) => reorderIds(prev, from, toIndex));
    }
    setSortKey("custom");
    setDragIndex(null);
    setDragMode(null);
  };

  const onDragEnd = () => {
    setDragIndex(null);
    setDragMode(null);
  };

  const renderPlayButtons = (card: TimestreamsCard) => (
    <div style={{ marginTop: 4 }}>
      {card.cardType === "invention" && (
        <button
          type="button"
          data-testid={`play-invention-${card.id}`}
          onClick={() => onPlayInvention(card.id)}
          disabled={
            !isMyTurn ||
            !isPlayPhase ||
            activePrompt ||
            (G.config?.rulesEnabled !== false &&
              !canPlayCard(G, playerID || "", card.id).ok)
          }
          style={{ fontSize: 10, marginRight: 4 }}
        >
          Play Invention
        </button>
      )}
      {card.cardType === "action" && (
        <button
          type="button"
          data-testid={`play-action-${card.id}`}
          onClick={() => onPlayAction(card.id)}
          disabled={
            !isMyTurn ||
            !isPlayPhase ||
            activePrompt ||
            (G.config?.rulesEnabled !== false &&
              !canPlayCard(G, playerID || "", card.id).ok)
          }
          title={
            G.config?.rulesEnabled !== false &&
            playerID &&
            !canPlayCard(G, playerID, card.id).ok
              ? canPlayCard(G, playerID, card.id).reason
              : undefined
          }
          style={{ fontSize: 10 }}
        >
          Play Action
        </button>
      )}
    </div>
  );

  const renderTile = (
    card: TimestreamsCard,
    opts: {
      index: number;
      count?: number;
      testId?: string;
    },
  ) => {
    const count = opts.count ?? 1;
    return (
      <div
        key={`${card.id}-${opts.index}`}
        data-testid={opts.testId || `hand-card-${card.id}`}
        data-card-id={card.id}
        data-group-count={count}
        draggable
        onDragStart={onDragStartCard(opts.index)}
        onDragOver={onDragOver}
        onDrop={onDropAt(opts.index)}
        onDragEnd={onDragEnd}
        style={{
          border:
            dragIndex === opts.index
              ? "2px solid #eab308"
              : "1px solid #64748b",
          padding: 6,
          fontSize: 11,
          background: "#0f172a",
          borderRadius: 4,
          width: card.imageUrl ? 120 : 110,
          cursor: "grab",
          position: "relative",
          opacity: dragIndex === opts.index ? 0.7 : 1,
        }}
        onMouseEnter={() => onCardHover(card)}
        onMouseLeave={() => onCardHover(null)}
      >
        {count > 1 && (
          <div
            data-testid={`hand-stack-badge-${card.id}`}
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              background: "#eab308",
              color: "#0f172a",
              fontWeight: 800,
              fontSize: 11,
              borderRadius: 10,
              padding: "1px 6px",
              zIndex: 1,
            }}
          >
            ×{count}
          </div>
        )}
        {card.imageUrl ? (
          <div
            style={{
              width: "100%",
              height: 168,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 4,
              marginBottom: 4,
              background: "#0b1220",
              overflow: "hidden",
            }}
          >
            <img
              src={card.imageUrl}
              alt={card.name || card.id}
              draggable={false}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                width: "auto",
                height: "auto",
                objectFit: "contain",
                objectPosition: "center",
                display: "block",
                pointerEvents: "none",
              }}
              loading="lazy"
            />
          </div>
        ) : null}
        <div style={{ fontWeight: 600 }}>{card.name || card.id}</div>
        <div style={{ color: "#94a3b8", fontSize: 10 }}>
          {card.cardType}
          {typeof card.scoreValue === "number" ? ` · ${card.scoreValue}` : ""}
        </div>
        {renderPlayButtons(card)}
      </div>
    );
  };

  return (
    <div
      data-testid="player-hand"
      style={{
        marginTop: 8,
        padding: 8,
        border: "1px solid #334155",
        borderRadius: 4,
        background: "#1e2937",
      }}
    >
      <div style={{ fontWeight: "bold", marginBottom: 6 }}>
        Your Hand (P{playerID}) — {myHand.length} cards
        {isMyTurn && isPlayPhase ? " — Your turn" : ""}
        {!isMyTurn && isPlayPhase ? ` — Waiting for P${currentPlayer}` : ""}
      </div>

      <div
        data-testid="hand-layout-controls"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          marginBottom: 8,
          fontSize: 12,
        }}
      >
        <label style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="checkbox"
            data-testid="hand-group-toggle"
            checked={groupEnabled}
            onChange={(e) => toggleGroup(e.target.checked)}
          />
          Group duplicates
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          Sort
          <select
            data-testid="hand-sort-key"
            value={sortKey}
            onChange={(e) => applySort(e.target.value as SortKey)}
            style={{ background: "#0f172a", color: "#e2e8f0", borderRadius: 4 }}
          >
            <option value="custom">Custom (drag)</option>
            <option value="name">Name</option>
            <option value="type">Type</option>
            <option value="score">Score</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          Dir
          <select
            data-testid="hand-sort-dir"
            value={sortDir}
            disabled={sortKey === "custom"}
            onChange={(e) => {
              const d = e.target.value as SortDir;
              setSortDir(d);
              if (sortKey !== "custom") {
                setHandOrder((prev) => sortHandIds(prev, byId, sortKey, d));
              }
            }}
            style={{ background: "#0f172a", color: "#e2e8f0", borderRadius: 4 }}
          >
            <option value="asc">Asc</option>
            <option value="desc">Desc</option>
          </select>
        </label>
        <span style={{ color: "#64748b", fontSize: 11 }}>
          Drag to reorder · sort overwrites custom order
        </span>
      </div>

      {myHand.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: 12 }}>
          {isSetupPhase || isCryptoPhase
            ? "Cards deal after setup completes."
            : "No cards in hand"}
        </div>
      ) : (
        <div
          data-testid="hand-tiles"
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
          onDragOver={onDragOver}
        >
          {groupEnabled
            ? groups.map((g, gi) => {
                const card =
                  (myHand.find((c) => c.id === g.representativeId) as
                    | TimestreamsCard
                    | undefined) ||
                  ({
                    id: g.representativeId,
                    name: g.key,
                    cardType: "invention" as const,
                    subtypes: [],
                    hasPlayEffect: false,
                    hasScoreEffect: false,
                    hasReact: false,
                    ownerId: playerID || "",
                  } as TimestreamsCard);
                return renderTile(card, {
                  index: gi,
                  count: g.cardIds.length,
                  testId: `hand-group-${g.key}`,
                });
              })
            : orderedCards.map((card, idx) =>
                renderTile(card, { index: idx }),
              )}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          data-testid="pass-turn"
          onClick={onPass}
          disabled={!isMyTurn || !isPlayPhase || activePrompt}
          style={{ padding: "6px 12px", marginRight: 8 }}
        >
          Pass
        </button>
        <span style={{ fontSize: 11, color: "#64748b" }}>
          Play one invention, one action, or pass each turn.
        </span>
      </div>
    </div>
  );
};
