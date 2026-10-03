/** Runs work sequentially within a conversation while allowing other conversations to proceed. */
export class ConversationQueue {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(conversationKey: string, task: () => Promise<T>): Promise<T> {
    const predecessor = this.#tails.get(conversationKey) ?? Promise.resolve();
    const result = predecessor.catch(() => undefined).then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );

    this.#tails.set(conversationKey, tail);

    try {
      return await result;
    } finally {
      if (this.#tails.get(conversationKey) === tail) {
        this.#tails.delete(conversationKey);
      }
    }
  }
}
