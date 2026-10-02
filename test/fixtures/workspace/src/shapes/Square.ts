export class Square {
  constructor(private readonly side: number) {}

  area(): number {
    return this.side * this.side;
  }

  describe(): string {
    return `Square with area ${this.area().toFixed(2)}`;
  }
}
