/**
 * Restaurant Booking Agent Test
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
  console.log('\n  Restaurant Booking Agent Test\n');

  const test = multiverse.describe({
    name: 'restaurant-booking-agent',
    task: 'Help the user make a restaurant reservation',
    agent: runAgent,
  });

  const results = await test.run({
    success: (world) => {
      const reservations = world.getCollection('reservations');
      return reservations.size > 0;
    },

    scenarioCount: 5,
    trialsPerScenario: 4,
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
    console.error('\nPass rate below threshold (70%)');
    process.exit(1);
  }

  console.log('\nTests passed!');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
