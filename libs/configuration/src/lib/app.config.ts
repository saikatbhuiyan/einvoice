import { IsNotEmpty, IsNumber, IsPositive } from 'class-validator';

export class AppConfiguration {
  @IsNumber()
  @IsNotEmpty()
  @IsPositive()
  PORT: number;

  constructor() {
    this.PORT = Number(process.env['PORT']);
  }
}
