export class AppConfiguration {
  PORT: number | string;

  constructor() {
    this.PORT = process.env['PORT'] || 3300;
  }
}
