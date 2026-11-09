// The shared contract of the agent panel (RFC 0001). This step holds only the token usage
// that the stream accumulator reports. The engines, turns, limits and the events the panel
// shows join it with Engine A's turn loop.

/** Tokens of one request or of a session. input is the uncached input only. */
export interface TokenUsage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}
