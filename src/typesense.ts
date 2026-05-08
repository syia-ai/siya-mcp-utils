import Typesense from "typesense";

export interface TypesenseConfig {
  host: string;
  port: number;
  protocol: string;
  apiKey: string;
}

export async function getTypesenseClient(config: TypesenseConfig): Promise<Typesense.Client | { content: Array<{type: string, text: string}>, isError: true }> {

   // Validate required parameters
   const { host, port, protocol, apiKey } = config;

   if (!host || !port || !protocol || !apiKey) {
     return {
       content: [{ type: "text", text: `Error in getTypesenseClient: Missing required Typesense configuration parameters` }],
       isError: true
     };
   }

   // Initialize Typesense client
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
