import { Client, Connection } from '@temporalio/client';
import { config, type Config } from '../lib/config';

export async function connectTemporalClient(
  options: Pick<Config, 'TEMPORAL_ADDRESS' | 'TEMPORAL_NAMESPACE'> = config,
): Promise<Client> {
  const connection = await Connection.connect({ address: options.TEMPORAL_ADDRESS });
  return new Client({ connection, namespace: options.TEMPORAL_NAMESPACE });
}
