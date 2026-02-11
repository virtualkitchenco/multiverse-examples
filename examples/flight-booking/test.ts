/**
 * Flight Booking Agent Test
 *
 * Demonstrates the Multiverse CI integration flow:
 * 1. PR opens
 * 2. CircleCI runs this test
 * 3. Report card appears in PR
 * 4. Link to dashboard for drill-down
 */

import { multiverse } from '@virtualkitchenco/multiverse-sdk';
import { runAgent } from './agent.js';

// Configure Multiverse
multiverse.configure({
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
  },
  baseUrl: process.env.MULTIVERSE_URL || 'http://localhost:3000',
  apiKey: process.env.MULTIVERSE_API_KEY,
});

async function main() {
  console.log('\n🔮 Multiverse CI Demo\n');

  const results = await multiverse.test({
    name: 'flight-booking-agent',
    agent: runAgent,
    task: 'Help the user book a flight',

    // Success: a booking was created
    success: (world, _trace) => {
      const bookings = world.getCollection('bookings');
      return bookings.size > 0;
    },

    // Test configuration
    scenarioCount: 5,
    runsPerScenario: 4,
    simulateUser: true,
    qualityThreshold: 70,

    // CI integration - auto-posts to PR
    ci: {
      postToPR: true,
      printReport: true,
    },

    onProgress: (p) => {
      console.log(`Progress: ${p.completed}/${p.total} runs`);
    },
  });

  // Summary
  console.log('\n========================================');
  console.log('RESULTS');
  console.log('========================================');
  console.log(`Pass Rate: ${results.passRate}%`);
  console.log(`Total Runs: ${results.runs.length}`);
  console.log(`Duration: ${(results.duration / 1000).toFixed(1)}s`);

  if (results.url) {
    console.log(`\nDashboard: ${results.url}`);
  }

  // Exit with error if pass rate is too low
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
