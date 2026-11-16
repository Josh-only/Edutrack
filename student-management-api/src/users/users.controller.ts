import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { LoginUserDto } from './dto/login-user.dto/login-user.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/current-user.decorator.js';
import { UpdateOwnAccountDto } from './dto/update-own-account.dto.js';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ChangeOwnPasswordDto } from './dto/change-own-password.dto.js';
import { AccountType } from './entities/user.entity.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('login')
  @UseGuards(ThrottlerGuard)
  async login(@Body() dto: LoginUserDto) {
    const user = await this.usersService.validateUser(dto.email, dto.password);
    const accessToken = await this.usersService.generateAccessToken(user);
    return {
      accessToken,
      tokenType: 'Bearer',
      id: user.id,
      email: user.email,
      accountType: user.accountType,
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) { return this.usersService.findCurrentUser(user.userId); }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateOwnAccountDto) {
    return this.usersService.updateOwnEmail(user.userId, dto.email);
  }

  @Patch('me/password')
  @UseGuards(JwtAuthGuard)
  changeOwnPassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangeOwnPasswordDto) {
    return this.usersService.updateOwnPassword(user.userId, dto.currentPassword, dto.newPassword);
  }

  @Post(':id/temporary-password')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(AccountType.SUPER_ADMIN)
  issueTemporaryPassword(@Param('id', ParseIntPipe) userId: number, @CurrentUser() actor: AuthenticatedUser) {
    return this.usersService.issueTemporaryPassword(userId, actor.userId);
  }
}
