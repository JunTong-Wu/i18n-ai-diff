import chalk from 'chalk';

interface ProgressBarOptions {
  total: number;
  width?: number;
  title?: string;
}

export class ProgressBar {
  private total: number;
  private current: number;
  private width: number;
  private title: string;
  private startTime: number;
  private lastLine = '';

  constructor(options: ProgressBarOptions) {
    this.total = options.total;
    this.current = 0;
    this.width = options.width || 30;
    this.title = options.title || 'Progress';
    this.startTime = Date.now();
  }

  log(message: string): void {
    this.clearLine();
    process.stderr.write(message + '\n');
    if (this.current > 0 && this.current < this.total) {
      this.drawBar();
    }
  }

  increment(message?: string): void {
    this.current++;
    this.clearLine();
    if (message) {
      const tag = chalk.gray(`[${this.current}/${this.total}]`);
      process.stderr.write(`${chalk.green('✓')} ${tag} ${message}\n`);
    }
    if (this.current < this.total) {
      this.drawBar();
    }
  }

  complete(): void {
    this.clearLine();
  }

  private clearLine(): void {
    if (this.lastLine) {
      process.stderr.write('\r\x1b[K');
      this.lastLine = '';
    }
  }

  private drawBar(): void {
    const pct = Math.floor((this.current / this.total) * 100);
    const filled = Math.floor((this.current / this.total) * this.width);
    const empty = this.width - filled;
    const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));

    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);

    this.lastLine = `${chalk.cyan(this.title)} ${bar} ${this.current}/${this.total} (${pct}%) ${chalk.gray(this.fmtTime(elapsed))}`;
    process.stderr.write(this.lastLine);
  }

  private fmtTime(s: number): string {
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }
}

export function createProgressBar(options: ProgressBarOptions): ProgressBar {
  return new ProgressBar(options);
}
