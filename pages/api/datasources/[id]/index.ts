import { NextApiResponse } from 'next';

import { AppNextApiRequest } from '@app/types/index';
import { createAuthApiHandler, respond } from '@app/utils/createa-api-handler';
import prisma from '@app/utils/prisma-client';
import triggerTaskRemoveDatasource from '@app/utils/trigger-task-remove-datasource';

const handler = createAuthApiHandler();

export const getDatasource = async (
  req: AppNextApiRequest,
  res: NextApiResponse
) => {
  const session = req.session;
  const id = req.query.id as string;

  const datasource = await prisma.appDatasource.findUnique({
    where: {
      id,
    },
    include: {
      datastore: {
        select: {
          name: true,
        },
      },
    },
  });

  if (datasource?.ownerId !== session?.user?.id) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  return datasource;
};

handler.get(respond(getDatasource));

export const deleteDatasource = async (
  req: AppNextApiRequest,
  res: NextApiResponse
) => {
  const session = req.session;
  const id = req.query.id as string;

  const datasource = await prisma.appDatasource.findUnique({
    where: {
      id,
    },
    include: {
      owner: true,
    },
  });

  if (datasource?.owner?.id !== session?.user?.id) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const deleted = await prisma.appDatasource.delete({
    where: {
      id,
    },
    include: {
      datastore: true,
    },
  });

  triggerTaskRemoveDatasource(deleted.datastore?.id!, id);

  return deleted;
};

handler.delete(respond(deleteDatasource));

export default handler;
