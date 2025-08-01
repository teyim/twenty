import { InjectRepository } from '@nestjs/typeorm';

import assert from 'assert';

import { TypeOrmQueryService } from '@ptc-org/nestjs-query-typeorm';
import { isWorkspaceActiveOrSuspended } from 'twenty-shared/workspace';
import { IsNull, Not, Repository } from 'typeorm';

import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { User } from 'src/engine/core-modules/user/user.entity';
import { userValidator } from 'src/engine/core-modules/user/user.validate';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { Workspace } from 'src/engine/core-modules/workspace/workspace.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import {
  PermissionsException,
  PermissionsExceptionCode,
  PermissionsExceptionMessage,
} from 'src/engine/metadata-modules/permissions/permissions.exception';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { TwentyORMGlobalManager } from 'src/engine/twenty-orm/twenty-orm-global.manager';
import { WorkspaceEventEmitter } from 'src/engine/workspace-event-emitter/workspace-event-emitter';
import { WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

// eslint-disable-next-line @nx/workspace-inject-workspace-repository
export class UserService extends TypeOrmQueryService<User> {
  constructor(
    @InjectRepository(User, 'core')
    private readonly userRepository: Repository<User>,
    @InjectRepository(ObjectMetadataEntity, 'core')
    private readonly objectMetadataRepository: Repository<ObjectMetadataEntity>,
    private readonly workspaceEventEmitter: WorkspaceEventEmitter,
    private readonly workspaceService: WorkspaceService,
    private readonly twentyORMGlobalManager: TwentyORMGlobalManager,
    private readonly userRoleService: UserRoleService,
    private readonly userWorkspaceService: UserWorkspaceService,
  ) {
    super(userRepository);
  }

  async loadWorkspaceMember(user: User, workspace: Workspace) {
    if (!isWorkspaceActiveOrSuspended(workspace)) {
      return null;
    }

    const workspaceMemberRepository =
      await this.twentyORMGlobalManager.getRepositoryForWorkspace<WorkspaceMemberWorkspaceEntity>(
        workspace.id,
        'workspaceMember',
      );

    return await workspaceMemberRepository.findOne({
      where: {
        userId: user.id,
      },
    });
  }

  async loadWorkspaceMembers(workspace: Workspace, withDeleted = false) {
    if (!isWorkspaceActiveOrSuspended(workspace)) {
      return [];
    }

    const workspaceMemberRepository =
      await this.twentyORMGlobalManager.getRepositoryForWorkspace<WorkspaceMemberWorkspaceEntity>(
        workspace.id,
        'workspaceMember',
      );

    return await workspaceMemberRepository.find({ withDeleted: withDeleted });
  }

  async loadDeletedWorkspaceMembersOnly(workspace: Workspace) {
    if (!isWorkspaceActiveOrSuspended(workspace)) {
      return [];
    }

    const workspaceMemberRepository =
      await this.twentyORMGlobalManager.getRepositoryForWorkspace<WorkspaceMemberWorkspaceEntity>(
        workspace.id,
        'workspaceMember',
      );

    return await workspaceMemberRepository.find({
      where: { deletedAt: Not(IsNull()) },
      withDeleted: true,
    });
  }

  private async deleteUserFromWorkspace({
    userId,
    workspaceId,
  }: {
    userId: string;
    workspaceId: string;
  }) {
    const workspaceMemberRepository =
      await this.twentyORMGlobalManager.getRepositoryForWorkspace<WorkspaceMemberWorkspaceEntity>(
        workspaceId,
        'workspaceMember',
      );

    const workspaceMembers = await workspaceMemberRepository.find();

    if (workspaceMembers.length > 1) {
      const userWorkspace =
        await this.userWorkspaceService.getUserWorkspaceForUserOrThrow({
          userId,
          workspaceId,
        });

      await this.userRoleService.validateUserWorkspaceIsNotUniqueAdminOrThrow({
        workspaceId,
        userWorkspaceId: userWorkspace.id,
      });
    }

    const workspaceMember = workspaceMembers.filter(
      (member: WorkspaceMemberWorkspaceEntity) => member.userId === userId,
    )?.[0];

    assert(workspaceMember, 'WorkspaceMember not found');

    await workspaceMemberRepository.delete({ userId });

    const objectMetadata = await this.objectMetadataRepository.findOneOrFail({
      where: {
        nameSingular: 'workspaceMember',
        workspaceId,
      },
    });

    if (workspaceMembers.length === 1) {
      await this.workspaceService.deleteWorkspace(workspaceId);

      return;
    }

    this.workspaceEventEmitter.emitDatabaseBatchEvent({
      objectMetadataNameSingular: 'workspaceMember',
      action: DatabaseEventAction.DELETED,
      events: [
        {
          recordId: workspaceMember.id,
          objectMetadata,
          properties: {
            before: workspaceMember,
          },
        },
      ],
      workspaceId,
    });
  }

  async deleteUser(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: {
        id: userId,
      },
      relations: ['workspaces'],
    });

    userValidator.assertIsDefinedOrThrow(user);

    await Promise.all(
      user.workspaces.map(async (userWorkspace) => {
        try {
          await this.deleteUserFromWorkspace({
            userId,
            workspaceId: userWorkspace.workspaceId,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
          if (
            error instanceof PermissionsException &&
            error.code === PermissionsExceptionCode.CANNOT_UNASSIGN_LAST_ADMIN
          ) {
            throw new PermissionsException(
              PermissionsExceptionMessage.CANNOT_DELETE_LAST_ADMIN_USER,
              PermissionsExceptionCode.CANNOT_DELETE_LAST_ADMIN_USER,
            );
          }
          throw error;
        }
      }),
    );

    return user;
  }

  async hasUserAccessToWorkspaceOrThrow(userId: string, workspaceId: string) {
    const user = await this.userRepository.findOne({
      where: {
        id: userId,
        workspaces: {
          workspaceId,
        },
      },
      relations: ['workspaces'],
    });

    userValidator.assertIsDefinedOrThrow(
      user,
      new AuthException(
        'User does not have access to this workspace',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      ),
    );
  }

  async getUserByEmail(email: string) {
    const user = await this.userRepository.findOne({
      where: {
        email,
      },
    });

    userValidator.assertIsDefinedOrThrow(user);

    return user;
  }

  async markEmailAsVerified(userId: string) {
    const user = await this.userRepository.findOne({
      where: {
        id: userId,
      },
    });

    userValidator.assertIsDefinedOrThrow(user);

    user.isEmailVerified = true;

    return await this.userRepository.save(user);
  }
}
