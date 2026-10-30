// One send as a list row: kind icon, what it says, the time, and chips for what
// happened to it. Sends that still wait on the phone have their own row with a
// visible «Reintentar». The server's result is shown as chips: «Anotado»
// (mint), «Milton te pregunta» (amarillo), «Espera aprobación» (grey) and
// «Esto entendí» (lavender, AI only). Never an amount.

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { HistoryItem } from "../api/types";
import { useStrings } from "../i18n";
import { formatClock } from "../lib/format";
import {
  QUICK_QUANTITIES,
  describeResult,
  quickReplyText,
} from "../lib/result";
import { newClientRef } from "../lib/ids";
import { sentToastText, showToast } from "../lib/toast";
import { dismiss, enqueue, retryNow } from "../send/outbox";
import type { OutboxItem } from "../send/outbox-core";
import { MIN_TOUCH, colors, fonts, radius, space } from "../theme";
import { Button, Card, Chip, Icon, Muted, type IconName } from "./ui";

const KIND_ICON: Record<string, IconName> = {
  photo: "camera-outline",
  voice: "mic-outline",
  document: "document-text-outline",
  text: "create-outline",
};

function Shell({
  kind,
  title,
  time,
  children,
}: {
  kind: string;
  title: string;
  time: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={st.row}>
      <View style={st.iconCol}>
        <Icon name={KIND_ICON[kind] ?? "create-outline"} size={22} />
      </View>
      <View style={st.body}>
        <View style={st.head}>
          <Text style={st.title} numberOfLines={3}>
            {title}
          </Text>
          <Text style={st.time}>{time}</Text>
        </View>
        {children}
      </View>
    </View>
  );
}

// «tomates: 5» already sent from a card, so its quick replies are not offered
// twice in this session (the server does not track the answer).
const answered = new Set<string>();

/** «Milton te pregunta»: how much of each product named without a price. */
function ExtrasCard({
  reportId,
  question,
  products,
}: {
  reportId: string;
  question: string;
  products: string[];
}) {
  const s = useStrings();
  const [, setTick] = useState(0);

  async function reply(product: string, quantity: number) {
    answered.add(`${reportId}:${product}`);
    setTick((t) => t + 1);
    await enqueue({
      id: newClientRef(),
      kind: "text",
      text: quickReplyText(product, quantity),
    });
    showToast(sentToastText(s.status.sent, { kind: "text", name: product }));
  }

  return (
    <Card style={st.question}>
      <Text style={st.questionText}>{question}</Text>
      {products.map((product) =>
        answered.has(`${reportId}:${product}`) ? (
          <Muted key={product}>{`${product} · ${s.status.sent}`}</Muted>
        ) : (
          <View key={product} style={st.quick}>
            <Text style={st.quickName}>{product}</Text>
            <View style={st.chips}>
              {QUICK_QUANTITIES.map((n) => (
                <Pressable
                  key={n}
                  accessibilityRole="button"
                  accessibilityLabel={`${product} ${n}`}
                  onPress={() => void reply(product, n)}
                  style={st.quickBtn}
                >
                  <Text style={st.quickText}>{n}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )
      )}
      <Muted>{s.status.answerHint}</Muted>
    </Card>
  );
}

/** A send that is already on the server, with Milton's reading of it. */
export function ServerRow({
  item,
  stuck = false,
  onRetry,
}: {
  item: HistoryItem;
  /** Still «processing» after two minutes: «Por enviar» with «Reintentar». */
  stuck?: boolean;
  onRetry?: () => void;
}) {
  const s = useStrings();
  const view = describeResult(item.result, s);
  const kindLabel = s.kinds[item.kind] ?? s.kinds.text;
  return (
    <Shell
      kind={item.kind}
      title={item.text || kindLabel}
      time={formatClock(item.createdAt)}
    >
      <View style={st.chips}>
        {stuck ? (
          <Chip tone="grey" label={s.status.queued} />
        ) : (
          view.chips.map((c) => (
            <Chip key={c.label} tone={c.tone} label={c.label} />
          ))
        )}
      </View>
      {stuck ? (
        <View style={st.failed}>
          <Muted>{s.status.stuckHint}</Muted>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.status.stuckRetry}
            onPress={onRetry}
            style={st.retry}
          >
            <Text style={st.retryText}>{s.status.stuckRetry}</Text>
          </Pressable>
        </View>
      ) : null}
      {view.extrasQuestion ? (
        <ExtrasCard
          reportId={item.id}
          question={view.extrasQuestion}
          products={view.extras}
        />
      ) : null}
      {view.understood ? <Muted>{view.understood}</Muted> : null}
      {view.question ? (
        <Card style={st.question}>
          <Text style={st.questionText}>{view.question}</Text>
          <Muted>{s.status.answerHint}</Muted>
        </Card>
      ) : null}
      {view.unclear ? <Muted>{view.unclear}</Muted> : null}
      {view.priceNote ? <Muted>{view.priceNote}</Muted> : null}
    </Shell>
  );
}

/** A send still on the phone (queued, sending, failed) or just sent. */
export function WaitingRow({ item }: { item: OutboxItem }) {
  const s = useStrings();
  const title = item.text || s.kinds[item.kind];
  return (
    <Shell kind={item.kind} title={title} time={formatClock(item.createdAt)}>
      <View style={st.chips}>
        {item.state === "sent" ? (
          <Chip tone="mint" label={s.status.sent} />
        ) : null}
        {item.state === "sending" ? (
          <Chip tone="grey" label={s.status.sending} />
        ) : null}
        {item.state === "pending" ? (
          <Chip tone="grey" label={s.status.queued} />
        ) : null}
      </View>
      {item.state === "pending" || item.state === "sending" ? (
        <Muted>{s.status.savedOnPhone}</Muted>
      ) : null}
      {item.state === "failed" ? (
        <View style={st.failed}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.status.failedLabel}
            onPress={() => retryNow(item.id)}
            style={st.retry}
          >
            <Text style={st.retryText}>{s.status.failedRetry}</Text>
          </Pressable>
          <Muted>{s.status.savedOnPhone}</Muted>
          {item.permanent ? (
            <View style={st.failed}>
              <Muted>{s.status.cannotSend}</Muted>
              <Button
                label={s.status.remove}
                variant="secondary"
                onPress={() => dismiss(item.id)}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </Shell>
  );
}

const st = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: space.m,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconCol: { width: 28, alignItems: "center", paddingTop: 2 },
  body: { flex: 1, gap: 8 },
  head: { flexDirection: "row", justifyContent: "space-between", gap: space.m },
  title: {
    flex: 1,
    fontSize: 17,
    fontFamily: fonts.semibold,
    color: colors.ink,
  },
  time: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.ink,
    opacity: 0.62,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  question: { gap: 6 },
  questionText: { fontSize: 16, fontFamily: fonts.semibold, color: colors.ink },
  quick: { gap: 6 },
  quickName: { fontSize: 15, fontFamily: fonts.semibold, color: colors.ink },
  quickBtn: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.m,
  },
  quickText: { fontSize: 17, fontFamily: fonts.bold, color: colors.ink },
  failed: { gap: space.s },
  retry: {
    minHeight: MIN_TOUCH,
    borderRadius: radius.pill,
    backgroundColor: colors.rosa,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.m,
    alignSelf: "flex-start",
  },
  retryText: { fontSize: 16, fontFamily: fonts.bold, color: colors.ink },
});
