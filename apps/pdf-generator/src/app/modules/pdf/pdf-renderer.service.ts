import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer-core';

@Injectable()
export class PdfRendererService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PdfRendererService.name);
  private browser?: Browser;

  // Launching Chromium takes ~1-2s — reusing one browser instance (one per process, new tab per
  // render) across every request avoids paying that cost on every single PDF, the same "expensive
  // resource, cheap reuse" shape this codebase already uses for its Mongo/Postgres connections.
  async onModuleInit(): Promise<void> {
    this.browser = await puppeteer.launch({
      executablePath: process.env['PUPPETEER_EXECUTABLE_PATH'],
      headless: true,
      // Required to run Chromium as root, which every container in this repo's Dockerfile does
      // (no USER directive drops privileges anywhere) — Chromium's own sandbox needs privileges
      // root already has, so it refuses to start as root unless the sandbox is disabled instead.
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    this.logger.log('Puppeteer browser launched');
  }

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close();
  }

  async renderPdf(html: string): Promise<Buffer> {
    if (!this.browser) {
      throw new Error('Puppeteer browser is not initialized');
    }

    const page = await this.browser.newPage();
    try {
      // The invoice template has no external resources (inline CSS only), so 'load' is enough —
      // setContent()'s type doesn't even accept 'networkidle0'/'networkidle2' the way goto() does.
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }
}
