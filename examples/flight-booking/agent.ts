/**
 * Demo Agent for CI Integration
 *
 * Flight booking agent that demonstrates the Multiverse CI flow.
 * This matches the example from the main multiverse repo.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { tool } from '@langchain/core/tools';
import { MemorySaver } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { z } from 'zod';
import { wrap, type AgentContext, type Effect } from '@virtualkitchenco/multiverse-sdk';

// =============================================================================
// Schemas
// =============================================================================

const FlightSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  price: z.number(),
  airline: z.string(),
  departure: z.string(),
  arrival: z.string(),
  seatsAvailable: z.number(),
});

const SearchResultSchema = z.object({
  flights: z.array(FlightSchema),
  searchId: z.string(),
});

const BookingSchema = z.object({
  bookingId: z.string(),
  flightId: z.string(),
  passengerName: z.string(),
  status: z.enum(['confirmed', 'pending', 'failed']),
  totalPrice: z.number(),
  confirmationCode: z.string(),
});

// =============================================================================
// Tools — your actual implementations
// =============================================================================

const searchFlightsTool = tool(
  async ({ from, to, departureDate, passengers, cabinClass }) => {
    const res = await fetch(`https://api.example.com/flights/search?from=${from}&to=${to}&date=${departureDate}&pax=${passengers}&class=${cabinClass ?? 'economy'}`);
    return res.json();
  },
  {
    name: 'searchFlights',
    description: 'Search for available flights between two cities on a specific date',
    schema: z.object({
      from: z.string().describe('Departure airport code (e.g., SFO, LAX, JFK)'),
      to: z.string().describe('Arrival airport code (e.g., NYC, SEA, MIA)'),
      departureDate: z.string().describe('Departure date in YYYY-MM-DD format'),
      returnDate: z.string().optional().describe('Return date for round-trip (YYYY-MM-DD), omit for one-way'),
      passengers: z.number().describe('Number of passengers'),
      cabinClass: z.enum(['economy', 'business', 'first']).optional().describe('Cabin class preference'),
    }),
  }
);

const bookFlightTool = tool(
  async ({ flightId, passengerName, email, creditCard }) => {
    const res = await fetch('https://api.example.com/flights/book', {
      method: 'POST',
      body: JSON.stringify({ flightId, passengerName, email, creditCard }),
    });
    return res.json();
  },
  {
    name: 'bookFlight',
    description: 'Book a flight and process payment',
    schema: z.object({
      flightId: z.string().describe('Flight ID from search results'),
      passengerName: z.string().describe('Full name of primary passenger'),
      email: z.string().describe('Email for booking confirmation'),
      creditCard: z.object({
        number: z.string().describe('Credit card number'),
        expiry: z.string().describe('Expiry date (MM/YY)'),
        cvv: z.string().describe('CVV code'),
      }).describe('Payment details'),
    }),
  }
);

// =============================================================================
// Wrap with Multiverse for simulation testing
// =============================================================================

export const searchFlights = wrap(searchFlightsTool, {
  output: SearchResultSchema,
  effects: (output) =>
    output.flights.map((flight) => ({
      operation: 'create' as const,
      collection: 'flights',
      id: flight.id,
      data: flight,
    })),
});

export const bookFlight = wrap(bookFlightTool, {
  output: BookingSchema,
  effects: (output, world) => {
    const effects: Effect[] = [
      {
        operation: 'create',
        collection: 'bookings',
        id: output.bookingId,
        data: output,
      },
    ];

    // Decrement seats on the booked flight
    const flight = world.getEntity('flights', output.flightId);
    if (flight) {
      const currentSeats = (flight.data.seatsAvailable as number) ?? 0;
      effects.push({
        operation: 'update',
        collection: 'flights',
        id: output.flightId,
        data: { seatsAvailable: currentSeats - 1 },
      });
    }

    return effects;
  },
  invariants: [
    { collection: 'flights', field: 'seatsAvailable', condition: 'gte', value: 0 },
  ],
});

export const tools = [searchFlights, bookFlight];

// =============================================================================
// Agent
// =============================================================================

function getSystemPrompt(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return `You are a flight booking assistant with access to real airline APIs.

CURRENT DATE/TIME: ${dateStr}, ${timeStr}

CAPABILITIES:
- Search flights across all major airlines
- Book flights and process payments
- Handle one-way and round-trip bookings

GUIDELINES:
1. Collect all required information before searching (dates, passengers, airports)
2. When tools return results, treat them as authoritative - do not add disclaimers
3. When a booking succeeds, confirm it confidently - you have real API access
4. Be concise and efficient - users want to book quickly
5. If a tool fails, acknowledge the error and offer to retry or find alternatives

Do not say things like "I can't actually book flights" or "this is simulated" - you have full booking capabilities.`;
}

// Lazy initialization to ensure env vars are available
let agent: ReturnType<typeof createReactAgent> | null = null;

function getAgent() {
  if (!agent) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is not set');
    }

    const llm = new ChatAnthropic({
      model: 'claude-sonnet-4-20250514',
      temperature: 0,
      anthropicApiKey: apiKey,
    });

    agent = createReactAgent({
      llm,
      tools,
      messageModifier: getSystemPrompt(),
      checkpointer: new MemorySaver(),
    });
  }
  return agent;
}

export async function runAgent(context: AgentContext): Promise<string> {
  const result = await getAgent().invoke(
    { messages: [{ role: 'user', content: context.userMessage }] },
    { configurable: { thread_id: context.runId } }
  );
  const last = result.messages[result.messages.length - 1];
  return typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
}
