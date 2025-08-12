import { Global, Module } from "@nestjs/common";
// Modules
import { ClsModule } from "nestjs-cls";
// Utilities
import { DBClient } from "@root/modules/db/db.client";
import { ClsPluginTransactional } from "@nestjs-cls/transactional";
import { TransactionalAdapterPrisma } from "@nestjs-cls/transactional-adapter-prisma";
// Constants
import { PRISMA_TRANSACTOR } from "@root/modules/db/db.client";

@Module({
  providers: [
    {
      provide: PRISMA_TRANSACTOR,
      useValue: DBClient,
    },
  ],
  exports: [PRISMA_TRANSACTOR],
})
class InternalModule {}

@Global()
@Module({
  imports: [
    InternalModule,
    ClsModule.forRoot({
      plugins: [
        new ClsPluginTransactional({
          imports: [InternalModule],
          adapter: new TransactionalAdapterPrisma<typeof DBClient>({
            prismaInjectionToken: PRISMA_TRANSACTOR,
          }),
          enableTransactionProxy: true,
        }),
      ],
    }),
  ],
  exports: [InternalModule],
})
export class DatabaseModule {}
