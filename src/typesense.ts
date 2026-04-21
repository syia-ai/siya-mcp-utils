import Typesense from "typesense";

export async function getTypesenseClient(): Promise<Typesense.Client | { content: Array<{type: string, text: string}>, isError: true }> {

   // Validate required environment variables
   const host = process.env.TYPESENSE_HOST;
   const port = process.env.TYPESENSE_PORT;
   const protocol = process.env.TYPESENSE_PROTOCOL;
   const apiKey = process.env.TYPESENSE_API_KEY;

   if (!host || !port || !protocol || !apiKey) {
     return {
       content: [{ type: "text", text: `Error in getTypesenseClient: Missing required Typesense environment variables` }],
       isError: true
     };
   }

   // Initialize Typesense client from scratch
   const typesenseConfig = {
     nodes: [
       {
         host,
         port: Number(port),
         protocol
       }
     ],
     apiKey,
     connectionTimeoutSeconds: 10,
   };

   return new Typesense.Client(typesenseConfig);
}
