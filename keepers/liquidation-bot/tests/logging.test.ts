import { describe, expect, it, vi } from 'vitest';
import { log, setLogContext } from '../src/core/logging.js';

describe('structured logging', () => {
  it('emits valid JSONL without prefixes and with context', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    setLogContext({ keeper: '0xkeeper', runId: 'run-1', component: 'test' });

    log.jsonInfo('test_event', { foo: 'bar' });

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(spy.mock.calls[0][0] as string);
    expect(payload.event).toBe('test_event');
    expect(payload.level).toBe('info');
    expect(payload.keeper).toBe('0xkeeper');
    expect(payload.runId).toBe('run-1');
    expect(payload.component).toBe('test');
    expect(payload.foo).toBe('bar');
    expect(payload.ts).toBeTruthy();
    spy.mockRestore();
  });
});
