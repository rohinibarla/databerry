import { z } from 'zod';

import { WebPageSourceSchema } from '@app/components/DatasourceForms/WebPageForm';
import type { Document } from '@app/utils/datastores/base';

import { DatasourceLoaderBase } from './base';

export class WebPageLoader extends DatasourceLoaderBase {
  async load() {
    const url: string = (
      this.datasource.config as z.infer<typeof WebPageSourceSchema>['config']
    )['source'];
    const loaders = await this.importLoaders();
    const docs = (await new loaders.CheerioWebBaseLoader(
      url
    ).load()) as Document[];

    return {
      ...docs?.[0],
      metadata: {
        ...docs?.[0]?.metadata,
        datasource_id: this.datasource.id,
        source_type: this.datasource.type,
        tags: [],
      },
    } as Document;
  }
}
