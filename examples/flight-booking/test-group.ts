/**
 * Flight Booking Agent Test — Group Booking
 *
 * Tests the agent's ability to book flights for multiple passengers.
 */

import { multiverse } from '@virtualkitchenco/multiverse-sdk';
import { runAgent } from './agent.js';

multiverse.configure({
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
  },
  baseUrl: process.env.MULTIVERSE_URL || 'http://localhost:3000',
  apiKey: process.env.MULTIVERSE_API_KEY,
});

async function main() {
  console.log('\n✈️  Flight Booking Agent Test — Group Booking\n');

  const results = await multiverse.test({
    name: 'flight-booking-agent',
    agent: runAgent,
    task: 'Help the user book flights for a group of passengers',

    success: (world, _trace) => {
      const bookings = world.getCollection('bookings');
      return bookings.size > 1;
    },

    scenarioCount: 5,
    runsPerScenario: 4,
    simulateUser: true,
    qualityThreshold: 70,

    onProgress: (p) => {
      console.log(`Progress: ${p.completed}/${p.total} runs`);
    },
  });

  console.log('\n========================================');
  console.log('RESULTS');
  console.log('========================================');
  console.log(`Pass Rate: ${results.passRate}%`);
  console.log(`Total Runs: ${results.runs.length}`);
  console.log(`Duration: ${(results.duration / 1000).toFixed(1)}s`);

  if (results.url) {
    console.log(`\nDashboard: ${results.url}`);
  }

  if (results.passRate < 70) {
    console.error('\n❌ Pass rate below threshold (70%)');
    process.exit(1);
  }

  console.log('\n✅ Tests passed!');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
