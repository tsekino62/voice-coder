export class Circle {
  constructor(private readonly radius: number) {}

  area(): number {
    return Math.PI * this.radius ** 2;
  }

  describe(): string {
    return `Circle with area ${this.area().toFixed(2)}`;
  }
}
