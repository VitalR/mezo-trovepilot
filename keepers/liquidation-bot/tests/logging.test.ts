import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLogContext, log, setLogContext } from '../src/core/logging.js';

describe('structured logging', () => {
  let consoleLogSpy: any;

  afterEach(() => {
    if (consoleLogSpy) consoleLogSpy.mockRestore();
    clearLogContext();
  });

  it('emits valid JSONL without prefixes and with context', () => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setLogContext({ keeper: '0xkeeper', runId: 'run-1', component: 'test' });

    log.jsonInfo('test_event', { foo: 'bar' });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(payload.event).toBe('test_event');
    expect(payload.level).toBe('info');
    expect(payload.keeper).toBe('0xkeeper');
    expect(payload.runId).toBe('run-1');
    expect(payload.component).toBe('test');
    expect(payload.foo).toBe('bar');
    expect(payload.ts).toBeTruthy();
  });

  it('includes run context in run_summary events', () => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setLogContext({
      keeper: '0xkeeper2',
      runId: 'run-ctx',
      network: 'mezo-testnet',
      component: 'index',
    });
    log.jsonInfo('run_summary', { jobs: { total: 1 } });
    const payload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(payload.event).toBe('run_summary');
    expect(payload.runId).toBe('run-ctx');
    expect(payload.keeper).toBe('0xkeeper2');
    expect(payload.network).toBe('mezo-testnet');
  });

  it('normalizes exceptions in JSON logs', () => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setLogContext({ component: 'test' });
    const err = new Error('boom');
    log.exception('test_exception', err, { foo: 'bar' });

    const payload = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(payload.event).toBe('test_exception');
    expect(payload.level).toBe('error');
    expect(payload.foo).toBe('bar');
    expect(payload.error.message).toBe('boom');
    expect(payload.component).toBe('test');
  });

  it('emits info/warn with error payload without forcing level error', () => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = new Error('not critical');

    log.jsonInfoWithError('non_critical', err, { foo: 'bar' });
    log.jsonWarnWithError('maybe_issue', err, { foo: 'baz' });

    const payloads = consoleLogSpy.mock.calls.map((c) =>
      JSON.parse(c[0] as string)
    );
    expect(payloads[0].level).toBe('info');
    expect(payloads[0].event).toBe('non_critical');
    expect(payloads[0].error.message).toBe('not critical');
    expect(payloads[1].level).toBe('warn');
    expect(payloads[1].event).toBe('maybe_issue');
    expect(payloads[1].error.message).toBe('not critical');
  });
});
