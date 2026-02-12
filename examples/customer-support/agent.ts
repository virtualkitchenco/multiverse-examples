/**
 * Customer Support Agent
 *
 * Looks up orders, processes refunds, and updates shipping addresses.
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

const AddressSchema = z.object({
  street: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  country: z.string(),
});

const OrderItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  quantity: z.number(),
  price: z.number(),
});

const OrderSchema = z.object({
  orderId: z.string(),
  customerName: z.string(),
  email: z.string(),
  items: z.array(OrderItemSchema),
  total: z.number(),
  status: z.enum(['pending', 'shipped', 'delivered', 'cancelled']),
  shippingAddress: AddressSchema,
  trackingNumber: z.string().optional(),
  orderDate: z.string(),
});

const RefundSchema = z.object({
  refundId: z.string(),
  orderId: z.string(),
  amount: z.number(),
  reason: z.string(),
  status: z.enum(['approved', 'pending', 'rejected']),
  processedDate: z.string(),
});

const ShippingUpdateSchema = z.object({
  updateId: z.string(),
  orderId: z.string(),
  oldAddress: AddressSchema,
  newAddress: AddressSchema,
  status: z.enum(['updated', 'failed']),
  updatedDate: z.string(),
});

// =============================================================================
// Tools — your actual implementations
// =============================================================================

const lookupOrderTool = tool(
  async ({ orderId, email }) => {
    const params = new URLSearchParams({
      ...(orderId && { orderId }),
      ...(email && { email }),
    });
    const res = await fetch(`https://api.example.com/orders/lookup?${params}`);
    return res.json();
  },
  {
    name: 'lookupOrder',
    description: 'Look up an order by order ID or customer email',
    schema: z.object({
      orderId: z.string().optional().describe('Order ID to look up'),
      email: z.string().optional().describe('Customer email address to search orders by'),
    }),
  }
);

const processRefundTool = tool(
  async ({ orderId, reason, amount }) => {
    const res = await fetch('https://api.example.com/orders/refund', {
      method: 'POST',
      body: JSON.stringify({ orderId, reason, amount }),
    });
    return res.json();
  },
  {
    name: 'processRefund',
    description: 'Process a refund for an order',
    schema: z.object({
      orderId: z.string().describe('Order ID to refund'),
      reason: z.string().describe('Reason for the refund'),
      amount: z.number().optional().describe('Partial refund amount — omit for full refund'),
    }),
  }
);

const updateShippingAddressTool = tool(
  async ({ orderId, newAddress }) => {
    const res = await fetch('https://api.example.com/orders/update-address', {
      method: 'POST',
      body: JSON.stringify({ orderId, newAddress }),
    });
    return res.json();
  },
  {
    name: 'updateShippingAddress',
    description: 'Update the shipping address for an order that has not yet been delivered',
    schema: z.object({
      orderId: z.string().describe('Order ID to update'),
      newAddress: z.object({
        street: z.string().describe('Street address'),
        city: z.string().describe('City'),
        state: z.string().describe('State or province'),
        zip: z.string().describe('ZIP or postal code'),
        country: z.string().describe('Country'),
      }).describe('New shipping address'),
    }),
  }
);

// =============================================================================
// Wrap with Multiverse for simulation testing
// =============================================================================

export const lookupOrder = wrap(lookupOrderTool, {
  output: OrderSchema,
  effects: (output) => [
    {
      operation: 'create' as const,
      collection: 'orders',
      id: output.orderId,
      data: output,
    },
  ],
});

export const processRefund = wrap(processRefundTool, {
  output: RefundSchema,
  effects: (output) => [
    {
      operation: 'create' as const,
      collection: 'refunds',
      id: output.refundId,
      data: output,
    },
    {
      operation: 'update' as const,
      collection: 'orders',
      id: output.orderId,
      data: { status: 'cancelled' },
    },
  ],
});

export const updateShippingAddress = wrap(updateShippingAddressTool, {
  output: ShippingUpdateSchema,
  effects: (output) => [
    {
      operation: 'create' as const,
      collection: 'shippingUpdates',
      id: output.updateId,
      data: output,
    },
    {
      operation: 'update' as const,
      collection: 'orders',
      id: output.orderId,
      data: { shippingAddress: output.newAddress },
    },
  ],
});

export const tools = [lookupOrder, processRefund, updateShippingAddress];

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

  return `You are a customer support agent for an online store with access to order management systems.

CURRENT DATE/TIME: ${dateStr}, ${timeStr}

CAPABILITIES:
- Look up orders by order ID or email address
- Process full or partial refunds
- Update shipping addresses for orders not yet delivered

GUIDELINES:
1. Start by looking up the customer's order to understand their issue
2. Be empathetic and professional - customers may be frustrated
3. When tools return results, treat them as authoritative - do not add disclaimers
4. Process refunds promptly when the customer requests one
5. For address updates, confirm the new address details with the customer before updating
6. If a tool fails, acknowledge the issue and offer to retry

Do not say things like "I can't actually process refunds" or "this is simulated" - you have full system access.`;
}

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
