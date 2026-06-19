type MessageSuccessLabel = "true" | "false";
type RetryReason = "412" | "429" | "5xx";
type DropReason = "throttled" | "failed";

const messageSendTotal: Record<MessageSuccessLabel, number> = {
  true: 0,
  false: 0,
};
const queuedMessagesTotal = { value: 0 };
const deliveredMessagesTotal = { value: 0 };
const throttledMessagesTotal = { value: 0 };
const queuedRetriesTotal: Record<RetryReason, number> = {
  "412": 0,
  "429": 0,
  "5xx": 0,
};
const droppedMessagesTotal: Record<DropReason, number> = {
  throttled: 0,
  failed: 0,
};
let sendQueueDepth = 0;
let deliveredLatencyMsTotal = 0;

export const metrics = {
  recordMessageSend(success: boolean) {
    messageSendTotal[success ? "true" : "false"] += 1;
  },

  recordQueuedMessage() {
    queuedMessagesTotal.value += 1;
  },

  recordQueuedMessageDelivered(latencyMs: number) {
    deliveredMessagesTotal.value += 1;
    deliveredLatencyMsTotal += latencyMs;
    messageSendTotal.true += 1;
  },

  recordQueuedMessageRetry(reason: RetryReason) {
    queuedRetriesTotal[reason] += 1;
  },

  recordQueuedMessageDropped(reason: DropReason) {
    droppedMessagesTotal[reason] += 1;
    messageSendTotal.false += 1;
  },

  recordSendThrottled() {
    throttledMessagesTotal.value += 1;
  },

  setSendQueueDepth(depth: number) {
    sendQueueDepth = depth;
  },

  renderPrometheus() {
    return [
      "# HELP teams_relay_messages_sent_total Total webhook message send attempts by success status.",
      "# TYPE teams_relay_messages_sent_total counter",
      `teams_relay_messages_sent_total{success="true"} ${messageSendTotal.true}`,
      `teams_relay_messages_sent_total{success="false"} ${messageSendTotal.false}`,
      "# HELP teams_relay_messages_queued_total Total webhook messages accepted into in-memory send queue.",
      "# TYPE teams_relay_messages_queued_total counter",
      `teams_relay_messages_queued_total ${queuedMessagesTotal.value}`,
      "# HELP teams_relay_messages_delivered_total Total queued messages delivered to Teams.",
      "# TYPE teams_relay_messages_delivered_total counter",
      `teams_relay_messages_delivered_total ${deliveredMessagesTotal.value}`,
      "# HELP teams_relay_send_retries_total Total queued send retries by reason.",
      "# TYPE teams_relay_send_retries_total counter",
      `teams_relay_send_retries_total{reason="412"} ${queuedRetriesTotal["412"]}`,
      `teams_relay_send_retries_total{reason="429"} ${queuedRetriesTotal["429"]}`,
      `teams_relay_send_retries_total{reason="5xx"} ${queuedRetriesTotal["5xx"]}`,
      "# HELP teams_relay_send_throttled_total Total Teams 429 throttling responses observed.",
      "# TYPE teams_relay_send_throttled_total counter",
      `teams_relay_send_throttled_total ${throttledMessagesTotal.value}`,
      "# HELP teams_relay_messages_dropped_total Total queued messages dropped after retry exhaustion or non-retryable errors.",
      "# TYPE teams_relay_messages_dropped_total counter",
      `teams_relay_messages_dropped_total{reason="throttled"} ${droppedMessagesTotal.throttled}`,
      `teams_relay_messages_dropped_total{reason="failed"} ${droppedMessagesTotal.failed}`,
      "# HELP teams_relay_send_queue_depth Current in-memory queued message count, excluding active sends.",
      "# TYPE teams_relay_send_queue_depth gauge",
      `teams_relay_send_queue_depth ${sendQueueDepth}`,
      "# HELP teams_relay_send_latency_ms_total Total queue-to-delivery latency milliseconds for delivered messages.",
      "# TYPE teams_relay_send_latency_ms_total counter",
      `teams_relay_send_latency_ms_total ${deliveredLatencyMsTotal}`,
      "",
    ].join("\n");
  },
};
