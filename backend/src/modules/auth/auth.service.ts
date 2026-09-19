import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from '../../entities/user.entity';
import { AuthResponseDto } from './dto/auth-response.dto';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const userCount = await this.userRepository.count();

      if (userCount === 0) {
        const passwordHash = await bcrypt.hash('admin123', 12);

        const adminUser = this.userRepository.create({
          email: 'admin@uptour.in',
          password_hash: passwordHash,
          name: 'Admin',
          role: UserRole.ADMIN,
          is_active: true,
        });

        await this.userRepository.save(adminUser);
        this.logger.log(
          'Default admin user created: admin@uptour.in / admin123',
        );
      }
    } catch (error) {
      this.logger.error('Failed to seed default admin user', error.stack);
    }
  }

  async validateUser(email: string, password: string): Promise<User> {
    try {
      const user = await this.userRepository.findOne({
        where: { email: email.toLowerCase() },
      });

      if (!user) {
        throw new UnauthorizedException('Invalid email or password');
      }

      if (!user.is_active) {
        throw new UnauthorizedException(
          'Account is deactivated. Contact an administrator.',
        );
      }

      const isPasswordValid = await bcrypt.compare(password, user.password_hash);

      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid email or password');
      }

      return user;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error('Error validating user', error.stack);
      throw new InternalServerErrorException('An error occurred during authentication');
    }
  }

  async login(user: User): Promise<AuthResponseDto> {
    try {
      const accessToken = this.generateAccessToken(user);
      const refreshToken = this.generateRefreshToken(user);

      await this.userRepository.update(user.id, {
        last_login_at: new Date(),
      });

      return {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      };
    } catch (error) {
      this.logger.error('Error during login', error.stack);
      throw new InternalServerErrorException('An error occurred during login');
    }
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>(
          'JWT_REFRESH_SECRET',
          'uptour-jwt-refresh-secret-default',
        ),
      });

      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      if (!user.is_active) {
        throw new UnauthorizedException(
          'Account is deactivated. Contact an administrator.',
        );
      }

      const newAccessToken = this.generateAccessToken(user);
      const newRefreshToken = this.generateRefreshToken(user);

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error('Error refreshing token', error.stack);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  private generateAccessToken(user: User): string {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET', 'uptour-jwt-secret-default'),
      expiresIn: this.configService.get<string>('JWT_EXPIRY', '15m'),
    } as any);
  }

  private generateRefreshToken(user: User): string {
    const payload = {
      sub: user.id,
    };

    return this.jwtService.sign(payload, {
      secret: this.configService.get<string>(
        'JWT_REFRESH_SECRET',
        'uptour-jwt-refresh-secret-default',
      ),
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRY', '7d'),
    } as any);
  }
}
