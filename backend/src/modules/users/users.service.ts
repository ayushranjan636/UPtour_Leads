import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../../entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findAll(): Promise<Omit<User, 'password_hash'>[]> {
    try {
      const users = await this.userRepository.find({
        select: [
          'id',
          'email',
          'name',
          'role',
          'is_active',
          'last_login_at',
          'created_at',
          'updated_at',
        ],
      });
      return users;
    } catch (error) {
      this.logger.error('Error fetching all users', error.stack);
      throw new InternalServerErrorException('Failed to fetch users');
    }
  }

  async findById(id: string): Promise<Omit<User, 'password_hash'>> {
    try {
      const user = await this.userRepository.findOne({
        where: { id },
        select: [
          'id',
          'email',
          'name',
          'role',
          'is_active',
          'last_login_at',
          'created_at',
          'updated_at',
        ],
      });

      if (!user) {
        throw new NotFoundException(`User with ID '${id}' not found`);
      }

      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error fetching user by ID: ${id}`, error.stack);
      throw new InternalServerErrorException('Failed to fetch user');
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    try {
      const user = await this.userRepository.findOne({
        where: { email: email.toLowerCase() },
      });
      return user;
    } catch (error) {
      this.logger.error(`Error fetching user by email: ${email}`, error.stack);
      throw new InternalServerErrorException('Failed to fetch user');
    }
  }

  async create(createUserDto: CreateUserDto): Promise<Omit<User, 'password_hash'>> {
    try {
      const existingUser = await this.userRepository.findOne({
        where: { email: createUserDto.email.toLowerCase() },
      });

      if (existingUser) {
        throw new ConflictException(
          `User with email '${createUserDto.email}' already exists`,
        );
      }

      const passwordHash = await bcrypt.hash(createUserDto.password, 12);

      const user = this.userRepository.create({
        email: createUserDto.email.toLowerCase(),
        password_hash: passwordHash,
        name: createUserDto.name,
        role: createUserDto.role,
      });

      const savedUser = await this.userRepository.save(user);

      const { password_hash, ...result } = savedUser;
      return result as Omit<User, 'password_hash'>;
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error('Error creating user', error.stack);
      throw new InternalServerErrorException('Failed to create user');
    }
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<Omit<User, 'password_hash'>> {
    try {
      const user = await this.userRepository.findOne({ where: { id } });

      if (!user) {
        throw new NotFoundException(`User with ID '${id}' not found`);
      }

      if (updateUserDto.email) {
        const existingUser = await this.userRepository.findOne({
          where: { email: updateUserDto.email.toLowerCase() },
        });

        if (existingUser && existingUser.id !== id) {
          throw new ConflictException(
            `User with email '${updateUserDto.email}' already exists`,
          );
        }
        user.email = updateUserDto.email.toLowerCase();
      }

      if (updateUserDto.password) {
        user.password_hash = await bcrypt.hash(updateUserDto.password, 12);
      }

      if (updateUserDto.name !== undefined) {
        user.name = updateUserDto.name;
      }

      if (updateUserDto.role !== undefined) {
        user.role = updateUserDto.role;
      }

      if (updateUserDto.is_active !== undefined) {
        user.is_active = updateUserDto.is_active;
      }

      const savedUser = await this.userRepository.save(user);

      const { password_hash, ...result } = savedUser;
      return result as Omit<User, 'password_hash'>;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      this.logger.error(`Error updating user: ${id}`, error.stack);
      throw new InternalServerErrorException('Failed to update user');
    }
  }

  async deactivate(id: string): Promise<Omit<User, 'password_hash'>> {
    try {
      const user = await this.userRepository.findOne({ where: { id } });

      if (!user) {
        throw new NotFoundException(`User with ID '${id}' not found`);
      }

      user.is_active = false;
      const savedUser = await this.userRepository.save(user);

      const { password_hash, ...result } = savedUser;
      return result as Omit<User, 'password_hash'>;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error deactivating user: ${id}`, error.stack);
      throw new InternalServerErrorException('Failed to deactivate user');
    }
  }
}
