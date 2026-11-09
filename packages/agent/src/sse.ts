// A server-sent-events parser over a byte stream, after the WHATWG HTML "event stream"
// rules: UTF-8 with a byte order mark skipped, lines that end in CRLF, LF or CR, comments,
// data over several lines, and an unfinished event at the end of the stream dropped. Chunks
// may split a line or a UTF-8 character anywhere. Written for Open3DJ under its MIT license.

/** One dispatched event. event is "message" when the stream named none. */
export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

/** The largest event the parser holds, in UTF-8 bytes of its lines (32 MiB). */
export const MAX_EVENT_BYTES = 32 * 1024 * 1024;

const LF = 10;
const CR = 13;

export class SseParser {
  #decoder = new TextDecoder("utf-8");
  #buf = "";
  /** Where the line end search resumes in #buf, so a long line is not scanned again and again. */
  #scan = 0;
  #event = "";
  #data: string[] = [];
  #id: string | undefined;
  #size = 0;
  #max: number;

  constructor(options: { maxEventBytes?: number } = {}) {
    this.#max = options.maxEventBytes ?? MAX_EVENT_BYTES;
  }

  /** Feed one chunk; returns the events it completed. */
  push(chunk: Uint8Array): SseEvent[] {
    return this.#feed(this.#decoder.decode(chunk, { stream: true }), false);
  }

  /** The stream ended: a last line end is honoured, an unfinished event is dropped. */
  end(): SseEvent[] {
    const out = this.#feed(this.#decoder.decode(), true);
    this.#buf = "";
    this.#scan = 0;
    this.#data = [];
    this.#event = "";
    this.#size = 0;
    return out;
  }

  #feed(text: string, final: boolean): SseEvent[] {
    const out: SseEvent[] = [];
    this.#buf += text;
    const buf = this.#buf;
    let start = 0;
    let i = this.#scan;
    for (; i < buf.length; i++) {
      const c = buf.charCodeAt(i);
      if (c !== LF && c !== CR) continue;
      if (c === CR && i + 1 === buf.length && !final) break; // a LF may follow in the next chunk
      this.#line(buf.slice(start, i), out);
      if (c === CR && buf.charCodeAt(i + 1) === LF) i++;
      start = i + 1;
    }
    this.#buf = buf.slice(start);
    this.#scan = i - start;
    if (this.#size + this.#buf.length > this.#max) throw this.#tooLarge();
    return out;
  }

  #line(line: string, out: SseEvent[]): void {
    if (line === "") {
      this.#dispatch(out);
      return;
    }
    if (line.charCodeAt(0) === 58) return; // ":" starts a comment
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.charCodeAt(0) === 32) value = value.slice(1);
    if (field === "event") this.#event = value;
    else if (field === "data") {
      this.#size += Buffer.byteLength(value) + 1;
      if (this.#size > this.#max) throw this.#tooLarge();
      this.#data.push(value);
    } else if (field === "id" && !value.includes("\0")) this.#id = value;
    // retry and unknown fields are ignored.
  }

  #dispatch(out: SseEvent[]): void {
    const data = this.#data;
    const event = this.#event;
    this.#data = [];
    this.#event = "";
    this.#size = 0;
    if (data.length === 0) return;
    const e: SseEvent = { event: event === "" ? "message" : event, data: data.join("\n") };
    if (this.#id !== undefined) e.id = this.#id;
    out.push(e);
  }

  #tooLarge(): Error {
    return new Error(`a server-sent event is larger than ${this.#max} bytes; the stream was stopped`);
  }
}

/** Every event of a byte stream: a web ReadableStream (fetch's body) or an async iterable. */
export async function* readSse(body: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>, options: { maxEventBytes?: number } = {}): AsyncGenerator<SseEvent> {
  const parser = new SseParser(options);
  for await (const chunk of body as AsyncIterable<Uint8Array>) yield* parser.push(chunk);
  yield* parser.end();
}
