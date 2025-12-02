// import * as restate from "@restatedev/restate-sdk";
// import { z } from "zod";
// import type { dailyClosingWorkflow } from "../workflows/dailyClosing";

// // Schema for API requests
// export const TriggerClosingRequest = z.object({
//   date: z.string(),
//   simulateGeniusClosing: z.boolean().optional().default(true),
//   skipOracleClosing: z.boolean().optional().default(false),
//   skipFinancialMetrics: z.boolean().optional().default(false),
// });

// export const TriggerClosingResponse = z.object({
//   success: z.boolean(),
//   message: z.string(),
//   workflowId: z.string(),
//   invocationId: z.string().optional(),
//   data: z.any().optional(),
// });

// // API Service for triggering workflows
// export const dailyClosingAPI = restate.service({
//   name: "DailyClosingAPI",
//   handlers: {
//     // Trigger daily closing workflow
//     triggerClosing: async (
//       ctx: restate.Context,
//       request: z.infer<typeof TriggerClosingRequest>
//     ): Promise<z.infer<typeof TriggerClosingResponse>> => {
//       try {
//         ctx.console.log(`📝 API Request received for date: ${request.date}`);

//         // Trigger the workflow asynchronously
//         const workflowId = request.date; // Use date as workflow ID
        
//         // Send workflow invocation  
//         ctx.workflowSendClient<typeof dailyClosingWorkflow>(
//           { name: "DailyClosing" },
//           workflowId
//         ).run({
//           date: request.date,
//           simulateGeniusClosing: request.simulateGeniusClosing,
//           skipOracleClosing: request.skipOracleClosing,
//           skipFinancialMetrics: request.skipFinancialMetrics,
//         });

//         ctx.console.log(`✅ Workflow triggered with ID: ${workflowId}`);

//         return {
//           success: true,
//           message: `Daily closing workflow triggered successfully for ${request.date}`,
//           workflowId,
//         };
//       } catch (error) {
//         ctx.console.error(`❌ Failed to trigger workflow: ${error}`);
        
//         return {
//           success: false,
//           message: error instanceof Error ? error.message : 'Unknown error',
//           workflowId: request.date,
//         };
//       }
//     },

//     // Get workflow status
//     getClosingStatus: async (
//       ctx: restate.Context,
//       request: { date: string }
//     ): Promise<z.infer<typeof TriggerClosingResponse>> => {
//       try {
//         const workflowId = request.date;
        
//         const result = await ctx
//           .workflowClient<typeof dailyClosingWorkflow>({ name: "DailyClosing" }, workflowId)
//           .getStatus();

//         return {
//           success: true,
//           message: 'Workflow status retrieved successfully',
//           workflowId,
//           data: result,
//         };
//       } catch (error) {
//         return {
//           success: false,
//           message: error instanceof Error ? error.message : 'Failed to get status',
//           workflowId: request.date,
//         };
//       }
//     },

//     // Health check endpoint
//     health: async (ctx: restate.Context): Promise<{ status: string; timestamp: string }> => {
//       return {
//         status: 'healthy',
//         timestamp: new Date().toISOString(),
//       };
//     },
//   },
// });
