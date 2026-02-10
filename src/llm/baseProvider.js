export class BaseProvider {
  constructor(model) {
    this.model = model;
  }

  async complete() {
    throw new Error("complete() must be implemented by subclasses");
  }
}
