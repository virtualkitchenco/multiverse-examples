# Multiverse Examples

Example agents demonstrating [Multiverse](https://github.com/virtualkitchenco/multiverse) simulation testing.

## Examples

### Flight Booking Agent

A flight booking assistant that demonstrates:
- Tool wrapping with `wrap()`
- Output schemas for simulation
- Effects for world state mutations
- Invariants for constraint enforcement
- CI integration with CircleCI

```bash
pnpm test:flight
```

## Setup

```bash
# Install dependencies
pnpm install

# Copy env template
cp .env.example .env
# Add your ANTHROPIC_API_KEY
```

## Running Locally

```bash
# Terminal 1: Start Multiverse server
cd /path/to/multiverse/packages/web
pnpm dev

# Terminal 2: Run tests
pnpm test
```

## CircleCI Setup

1. Add project to CircleCI
2. Create a context called `multiverse` with:
   - `ANTHROPIC_API_KEY`
   - `GITHUB_TOKEN` (for PR comments)
3. Set `MULTIVERSE_URL` in the config to your hosted server

## How It Works

```typescript
// Tools are wrapped with Multiverse
const searchFlights = wrap(searchFlightsTool, {
  name: 'searchFlights',
  outputSchema: SearchResultSchema,
  effects: (output) => output.flights.map(f => ({
    operation: 'create',
    collection: 'flights',
    id: f.id,
    data: f,
  })),
});

// Tests verify world state
const results = await multiverse.test({
  agent: runAgent,
  task: 'Help the user book a flight',
  success: (world) => {
    const bookings = world.getCollection('bookings');
    return bookings.size > 0;
  },
});
```

## License

MIT

