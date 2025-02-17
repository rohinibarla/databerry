import { Datastore } from '@prisma/client';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { Embeddings, OpenAIEmbeddings } from 'langchain/embeddings';
import { z } from 'zod';

import { Chunk, MetadataFields } from '@app/types';
import { QdrantConfigSchema } from '@app/types/models';

import uuidv4 from '../uuid';

import { ClientManager } from './base';

type DatastoreType = Datastore & {
  config: z.infer<typeof QdrantConfigSchema>;
};

type Point = {
  id: string;
  vector: number[];
  payload: Omit<Chunk['metadata'], 'chunk_id'> & {
    text: string;
  };
};

export class QdrantManager extends ClientManager<DatastoreType> {
  client: AxiosInstance;
  embeddings: Embeddings;

  constructor(datastore: DatastoreType) {
    super(datastore);

    this.embeddings = new OpenAIEmbeddings();

    this.client = axios.create({
      baseURL: process.env.QDRANT_API_URL,
      headers: {
        'api-key': process.env.QDRANT_API_KEY,
      },
    });
  }

  private async createCollection() {
    await this.client.put(`/collections/${this.datastore.id}`, {
      name: this.datastore.id,
      hnsw_config: {
        m: 16,
      },
      optimizers_config: {
        memmap_threshold: 1024,
      },
      vectors: {
        size: 1536,
        distance: 'Cosine',
      },
      on_disk_payload: true,
    });

    await this.client.put(`/collections/${this.datastore.id}/index`, {
      field_name: MetadataFields.datasource_id,
      field_schema: 'keyword',
    });

    await this.client.put(`/collections/${this.datastore.id}/index`, {
      field_name: MetadataFields.tags,
      field_schema: 'keyword',
    });

    await this.client.put(`/collections/${this.datastore.id}/index`, {
      field_name: MetadataFields.text,
      field_schema: {
        type: 'text',
        tokenizer: 'word',
      },
    });
  }

  private async addDocuments(
    documents: Chunk[],
    ids?: string[]
  ): Promise<void> {
    const texts = documents.map(({ pageContent }) => pageContent);
    return this.addVectors(
      await this.embeddings.embedDocuments(texts),
      documents,
      ids
    );
  }

  private async addVectors(
    vectors: number[][],
    documents: Chunk[],
    ids?: string[]
  ): Promise<void> {
    const documentIds = ids == null ? documents.map(() => uuidv4()) : ids;
    const qdrantVectors = vectors.map(
      (vector, idx) =>
        ({
          id: documentIds[idx],
          payload: {
            text: documents[idx].pageContent,
            source: documents[idx].metadata.source,
            tags: documents[idx].metadata.tags,
            chunk_hash: documents[idx].metadata.chunk_hash,
            chunk_offset: documents[idx].metadata.chunk_offset,
            datasource_hash: documents[idx].metadata.datasource_hash,
            datasource_id: documents[idx].metadata.datasource_id,
          },
          vector,
        } as Point)
    );

    // Pinecone recommends a limit of 100 vectors per upsert request
    const chunkSize = 50;
    for (let i = 0; i < qdrantVectors.length; i += chunkSize) {
      const chunk = qdrantVectors.slice(i, i + chunkSize);
      await this.client.put(`/collections/${this.datastore.id}/points`, {
        points: chunk,
      });
    }
  }

  async delete() {
    return this.client.delete(`/collections/${this.datastore.id}`);
  }

  async remove(datasourceId: string) {
    return this.client.post(`/collections/${this.datastore.id}/points/delete`, {
      filter: {
        must: [
          {
            key: 'datasource_id',
            match: {
              value: datasourceId,
            },
          },
        ],
      },
    });
  }

  async upload(documents: Chunk[]) {
    const ids: string[] = documents.map((each) => each.metadata.chunk_id);
    const datasourceId = documents[0].metadata.datasource_id;

    try {
      await this.remove(datasourceId);
      await this.addDocuments(documents, ids);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if ((error as AxiosError).response?.status === 404) {
          // Collection does not exist, create it
          await this.createCollection();
          await this.addDocuments(documents, ids);
        }
      } else {
        console.log(error);
        throw error;
      }
    }

    return documents;
  }

  async search(props: any) {
    const vectors = await this.embeddings.embedDocuments([props.query]);

    const results = await this.client.post(
      `/collections/${this.datastore.id}/points/search`,
      {
        vector: vectors[0],
        limit: props.topK,
        with_payload: true,
        with_vectors: false,
      }
    );

    return (results.data?.result || [])?.map((each: any) => ({
      score: each?.score,
      source: each?.payload?.source,
      text: each?.payload?.text,
    }));
  }
}
