type MessageSuccessLabel = "true" | "false";

const messageSendTotal: Record<MessageSuccessLabel, number> = {
  true: 0,
  false: 0,
};

export const metrics = {
  recordMessageSend(success: boolean) {
    messageSendTotal[success ? "true" : "false"] += 1;
  },

  renderPrometheus() {
    return [
      "# HELP teams_relay_messages_sent_total Total webhook message send attempts by success status.",
      "# TYPE teams_relay_messages_sent_total counter",
      `teams_relay_messages_sent_total{success="true"} ${messageSendTotal.true}`,
      `teams_relay_messages_sent_total{success="false"} ${messageSendTotal.false}`,
      "",
    ].join("\n");
  },
};
