// Stove replies shaped like an Aduro H2's, and a fake UDP client speaking
// through them. No socket is ever opened.

export const SERIAL = '123456';
export const PIN = '9876543210';

/** Payload of function 11 "001*" (operating values). */
export function operatingPayload(values = {}) {
  const fields = new Array(122).fill('0');
  const set = {
    0: values.boiler_temp ?? '21.5',
    1: values.boiler_ref ?? '22',
    5: values.substate ?? '5',
    6: values.state ?? '5',
    24: '1200',
    26: values.co ?? '12',
    31: values.power_kw ?? '4.5',
    35: values.shaft_temp ?? '60',
    37: values.smoke_temp ?? '180',
    99: values.power_pct ?? '50',
    101: '200',
    102: '1000',
    104: '1',
    119: '36000',
    120: '1800',
    121: '72000',
  };
  for (const [index, value] of Object.entries(set)) {
    fields[Number(index)] = String(value);
  }
  return fields.join(',');
}

/** Payload of function 11 "*" (status values). */
export function statusPayload({ mode = 0, total = 1234.5, fixedPower = 0 } = {}) {
  const fields = new Array(116).fill('0');
  fields[92] = String(total);
  fields[99] = String(fixedPower);
  fields[100] = String(mode);
  return fields.join(',');
}

export const NETWORK_PAYLOAD =
  'router=MyWifi,x,x,x,192.168.60.50,192.168.60.1,-61,x,x,AA:BB:CC:DD:EE:FF';

export function daysPayload(values) {
  return `total_days=${values.join(',')}`;
}

export function monthsPayload(values) {
  return `total_months=${values.join(',')}`;
}

/**
 * A StoveClient stand-in: `state` holds what the stove reports, `sets`
 * records the writes, `failing` makes every request time out.
 */
export class FakeClient {
  constructor(state = {}) {
    this.state = {
      operating: {},
      mode: 0,
      total: 1234.5,
      fixedPower: 0,
      days: new Array(31).fill(0),
      months: new Array(12).fill(0),
      ...state,
    };
    this.sets = [];
    this.requests = [];
    this.failing = false;
    // Applied when a write is received, like the stove would.
    this.applyWrites = true;
  }

  async reply(host, payload) {
    this.requests.push(host);
    if (this.failing) {
      throw new Error(`No reply from the stove at ${host}`);
    }
    return { payload };
  }

  getStatus(host) {
    return this.reply(
      host,
      statusPayload({
        mode: this.state.mode,
        total: this.state.total,
        fixedPower: this.state.fixedPower,
      }),
    );
  }

  getOperating(host) {
    return this.reply(host, operatingPayload(this.state.operating));
  }

  getSettings(host) {
    return this.reply(host, NETWORK_PAYLOAD);
  }

  getConsumption(host, table) {
    return this.reply(
      host,
      table === 'total_days' ? daysPayload(this.state.days) : monthsPayload(this.state.months),
    );
  }

  async set(host, path, value) {
    await this.reply(host, '');
    this.sets.push([path, value]);
    if (!this.applyWrites) {
      return;
    }
    if (path === 'regulation.operation_mode') {
      this.state.mode = Number(value);
    } else if (path === 'regulation.fixed_power') {
      this.state.fixedPower = Number(value);
      this.state.operating = { ...this.state.operating, power_pct: String(value) };
    } else if (path === 'boiler.temp') {
      this.state.operating = { ...this.state.operating, boiler_ref: String(value) };
    } else if (path === 'misc.start') {
      this.state.operating = { ...this.state.operating, state: '2', substate: '2' };
    } else if (path === 'misc.stop') {
      this.state.operating = { ...this.state.operating, state: '14', substate: '0' };
    }
  }
}

/** Manual clock + timers, advanced by the tests. */
export class FakeClock {
  constructor(start = new Date('2026-11-24T10:00:00').getTime()) {
    this.time = start;
    this.pending = [];
    this.nextId = 1;
    this.now = () => this.time;
    this.sleep = async (ms) => {
      this.time += ms;
    };
    this.timers = {
      setTimeout: (fn, ms) => this.add(fn, ms, false),
      setInterval: (fn, ms) => this.add(fn, ms, true),
      clearTimeout: (id) => this.remove(id),
      clearInterval: (id) => this.remove(id),
    };
  }

  add(fn, ms, repeat) {
    const id = this.nextId++;
    this.pending.push({ id, fn, at: this.time + ms, ms, repeat });
    return id;
  }

  remove(id) {
    this.pending = this.pending.filter((timer) => timer.id !== id);
  }

  /** Move the clock forward, running the timers due on the way. */
  async advance(ms) {
    const end = this.time + ms;
    for (;;) {
      const due = this.pending.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) {
        break;
      }
      this.time = Math.max(this.time, due.at);
      if (due.repeat) {
        due.at += due.ms;
      } else {
        this.remove(due.id);
      }
      await due.fn();
      await new Promise((resolve) => setImmediate(resolve));
    }
    this.time = end;
  }
}

export class MemoryStore {
  constructor(initial = {}) {
    this.state = initial;
    this.saves = 0;
  }

  async load() {
    return { ...this.state };
  }

  async save(state) {
    this.state = { ...state };
    this.saves += 1;
  }
}
