/**
 * Commander engine contract.
 *
 * Commander is a headless `claude` supervisor (spawned by the Rust
 * `commander_send` command) that the user converses with. This module defines
 * the small, self-contained surface the UI codes against: a {@link CommanderMessage}
 * result and a {@link CommanderEngine} interface. The overlay depends only on
 * `CommanderEngine`; the app wires the real engine over `commanderSend`.
 *
 * Field names are camelCase to match the Rust `#[serde(rename_all = "camelCase")]`
 * `CommanderReply` returned by the command.
 */

/** One Commander turn's result: the reply text and the conversation id. */
export interface CommanderMessage {
  /** The assistant's reply text for this turn. */
  reply: string;
  /**
   * The conversation id. Pass it back on the next {@link CommanderEngine.ask}
   * call to continue the same conversation.
   */
  sessionId: string;
}

/**
 * The engine the Commander UI talks to. A single multi-turn conversation is
 * driven by threading `sessionId`: omit it to begin a conversation, then pass
 * the returned `sessionId` on every following turn.
 *
 * Implemented over the `commanderSend` IPC command (see
 * `src/ipc/commands.ts`); the overlay codes against this interface only.
 */
export interface CommanderEngine {
  /**
   * Send `message` to Commander and resolve its reply + conversation id.
   *
   * @param message  The user's message for this turn.
   * @param sessionId  The conversation id from a prior turn; omit on the first
   *   turn to start a new conversation.
   */
  ask(message: string, sessionId?: string): Promise<CommanderMessage>;
}
