import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import chalk from 'chalk';
import {
  formatNum,
  printArray,
  printBlank,
  printDivider,
  printError,
  printField,
  printFieldRow,
  printHeader,
  printInfo,
  printProgress,
  printProgressComplete,
  printSuccess,
  printWarning
} from './format';

chalk.level = 0;

const BOX = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│'
};

type ConsoleMethod = 'log' | 'error';

function captureConsole(method: ConsoleMethod) {
  const original = console[method];
  const calls: string[] = [];
  console[method] = (...args: unknown[]) => {
    calls.push(args.map(String).join(' '));
  };
  return {
    calls,
    restore: () => {
      console[method] = original;
    }
  };
}

function captureStdout() {
  const original = process.stdout.write.bind(process.stdout);
  let output = '';
  process.stdout.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((err?: Error) => void), cb?: (err?: Error) => void) => {
    const actualEncoding = typeof encoding === 'string' ? encoding : undefined;
    const callback = typeof encoding === 'function' ? encoding : cb;
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(actualEncoding);
    if (callback) callback();
    return true;
  }) as typeof process.stdout.write;
  return {
    get output() {
      return output;
    },
    restore: () => {
      process.stdout.write = original;
    }
  };
}

describe('format helpers', () => {
  it('prints boxed headers with subtitle when provided', () => {
    const capture = captureConsole('log');
    try {
      printHeader('Title', 'Subtitle');
    } finally {
      capture.restore();
    }

    assert.equal(capture.calls.length, 5);
    assert.equal(capture.calls[0], '');

    const width = Math.max('Title'.length, 'Subtitle'.length) + 4;
    const line = BOX.horizontal.repeat(width);
    assert.equal(capture.calls[1], `${BOX.topLeft}${line}${BOX.topRight}`);
    assert.equal(
      capture.calls[2],
      `${BOX.vertical}  Title${' '.repeat(width - 'Title'.length - 2)}${BOX.vertical}`
    );
    assert.equal(
      capture.calls[3],
      `${BOX.vertical}  Subtitle${' '.repeat(width - 'Subtitle'.length - 2)}${BOX.vertical}`
    );
    assert.equal(capture.calls[4], `${BOX.bottomLeft}${line}${BOX.bottomRight}`);
  });

  it('prints boxed headers without a subtitle line', () => {
    const capture = captureConsole('log');
    try {
      printHeader('Solo');
    } finally {
      capture.restore();
    }

    assert.equal(capture.calls.length, 4);
    assert.equal(capture.calls[0], '');

    const width = 'Solo'.length + 4;
    const line = BOX.horizontal.repeat(width);
    assert.equal(capture.calls[1], `${BOX.topLeft}${line}${BOX.topRight}`);
    assert.equal(
      capture.calls[2],
      `${BOX.vertical}  Solo${' '.repeat(width - 'Solo'.length - 2)}${BOX.vertical}`
    );
    assert.equal(capture.calls[3], `${BOX.bottomLeft}${line}${BOX.bottomRight}`);
  });

  it('prints dividers and blank lines', () => {
    const capture = captureConsole('log');
    try {
      printDivider();
      printBlank();
    } finally {
      capture.restore();
    }

    assert.equal(capture.calls[0], BOX.horizontal.repeat(40));
    assert.equal(capture.calls[1], '');
  });

  it('prints labeled fields and rows', () => {
    const capture = captureConsole('log');
    try {
      printField('Status', 'OK');
      printField('Count', 7, { color: 'green' });
      printFieldRow([
        { label: 'A', value: '1' },
        { label: 'B', value: 2 }
      ]);
      printArray('Values', [1.2345, 2], 3);
    } finally {
      capture.restore();
    }

    assert.equal(capture.calls[0], '  Status: OK');
    assert.equal(capture.calls[1], '  Count: 7');
    assert.equal(capture.calls[2], '  A: 1  │  B: 2');
    assert.equal(capture.calls[3], '  Values: [1.23, 2.00]');
  });

  it('prints status messages to the right streams', () => {
    const logCapture = captureConsole('log');
    const errorCapture = captureConsole('error');
    try {
      printSuccess('Saved');
      printWarning('Careful');
      printInfo('Note');
      printError('Failed');
    } finally {
      logCapture.restore();
      errorCapture.restore();
    }

    assert.deepEqual(logCapture.calls, ['✓ Saved', '⚠ Careful', 'ℹ Note']);
    assert.deepEqual(errorCapture.calls, ['✗ Failed']);
  });

  it('prints progress updates and completion', () => {
    const stdoutCapture = captureStdout();
    try {
      printProgress(3, 4, 'Load');
    } finally {
      stdoutCapture.restore();
    }

    const bar = '█'.repeat(15) + '░'.repeat(5);
    assert.equal(stdoutCapture.output, `\rLoad [${bar}] 75%`);

    const logCapture = captureConsole('log');
    try {
      printProgressComplete('Load');
    } finally {
      logCapture.restore();
    }

    assert.equal(logCapture.calls[0], `\rLoad [${'█'.repeat(20)}] Done!`);
  });

  it('formats numbers for display', () => {
    assert.equal(formatNum(NaN), 'NaN');
    assert.equal(formatNum(Infinity), 'Infinity');
    assert.equal(formatNum(0), '0.000');
    assert.equal(formatNum(12.3456), '12.35');
    assert.equal(formatNum(1e-4), '1.0000e-4');
    assert.equal(formatNum(12345), '1.2345e+4');
  });
});
