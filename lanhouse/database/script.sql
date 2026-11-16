-- =====================================================================================
--  Ping Lounge - script do banco de dados (MySQL 8.0 ou superior; também roda no MariaDB 10.5+)
--
--  Como executar (na VM 2, com um usuário administrador do MySQL):
--      mysql -u root -p < database/script.sql
--  No Windows (CMD, na pasta do projeto):
--      "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p < database\script.sql
--
--  O script pode ser executado mais de uma vez: ele não apaga dados existentes.
--  O usuário ADMINISTRADOR não é criado aqui (para não guardar senha no SQL).
--  Crie-o com:  npm run criar-admin   (veja o README).
-- =====================================================================================

CREATE DATABASE IF NOT EXISTS lanhouse
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE lanhouse;

-- -------------------------------------------------------------------------------------
--  USUARIOS: clientes e administradores
--  - email é UNIQUE e a collation é case-insensitive: "Ana@x.com" e "ana@x.com" são o mesmo e-mail
--  - senha_hash guarda o hash bcrypt (nunca a senha)
--  - ativo = 0 bloqueia o login sem apagar o histórico de reservas
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  nome           VARCHAR(120)  NOT NULL,
  email          VARCHAR(190)  NOT NULL,
  senha_hash     VARCHAR(100)  NOT NULL,
  perfil         ENUM('cliente','admin') NOT NULL DEFAULT 'cliente',
  ativo          TINYINT(1)    NOT NULL DEFAULT 1,
  criado_em      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email),
  KEY idx_usuarios_perfil_nome (perfil, nome),
  CONSTRAINT ck_usuarios_ativo CHECK (ativo IN (0, 1))
) ENGINE=InnoDB;

-- -------------------------------------------------------------------------------------
--  COMPUTADORES
--  status: disponivel (aceita reservas) | manutencao (temporário) | desativado (fora de uso)
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS computadores (
  id             SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome           VARCHAR(40)   NOT NULL,
  descricao      VARCHAR(255)  NOT NULL DEFAULT '',
  status         ENUM('disponivel','manutencao','desativado') NOT NULL DEFAULT 'disponivel',
  criado_em      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_computadores_nome (nome)
) ENGINE=InnoDB;

-- -------------------------------------------------------------------------------------
--  AGENDAMENTOS
--  - inicio/fim são DATETIME no "horário de parede" da lan house (sem fuso)
--  - FOREIGN KEY ... RESTRICT: não é possível apagar um cliente ou computador que tenha reservas
--  - o índice (computador_id, inicio, fim) acelera a checagem de conflito de horário
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agendamentos (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  usuario_id     INT UNSIGNED  NOT NULL,
  computador_id  SMALLINT UNSIGNED NOT NULL,
  inicio         DATETIME      NOT NULL,
  fim            DATETIME      NOT NULL,
  duracao_min    SMALLINT UNSIGNED NOT NULL,
  status         ENUM('confirmado','cancelado','concluido') NOT NULL DEFAULT 'confirmado',
  cancelado_por  ENUM('cliente','admin') NULL,
  cancelado_em   DATETIME      NULL,
  criado_em      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agendamentos_pc_periodo (computador_id, inicio, fim),
  KEY idx_agendamentos_usuario (usuario_id, inicio),
  KEY idx_agendamentos_status_inicio (status, inicio),
  CONSTRAINT fk_agendamentos_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_agendamentos_computador
    FOREIGN KEY (computador_id) REFERENCES computadores (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ck_agendamentos_periodo CHECK (fim > inicio),
  CONSTRAINT ck_agendamentos_duracao CHECK (duracao_min > 0)
) ENGINE=InnoDB;

-- -------------------------------------------------------------------------------------
--  COMPUTADORES INICIAIS PARA DEMONSTRAÇÃO
--  INSERT IGNORE + nome UNIQUE: rodar o script de novo não duplica as máquinas.
--  Edite as descrições para refletir o hardware real (ou altere pelo painel administrativo).
-- -------------------------------------------------------------------------------------
INSERT IGNORE INTO computadores (nome, descricao, status) VALUES
  ('PC-01', 'Ryzen 5 5600, RTX 3060 12 GB, 16 GB de RAM, monitor 165 Hz', 'disponivel'),
  ('PC-02', 'Ryzen 5 5600, RTX 3060 12 GB, 16 GB de RAM, monitor 165 Hz', 'disponivel'),
  ('PC-03', 'Ryzen 5 5600, RTX 3060 12 GB, 16 GB de RAM, monitor 165 Hz', 'disponivel'),
  ('PC-04', 'Ryzen 5 5600, RTX 3060 12 GB, 16 GB de RAM, monitor 165 Hz', 'disponivel'),
  ('PC-05', 'Ryzen 5 5600, RTX 3060 12 GB, 16 GB de RAM, monitor 165 Hz', 'disponivel'),
  ('PC-06', 'Ryzen 5 5600, RTX 3060 12 GB, 16 GB de RAM, monitor 165 Hz', 'disponivel'),
  ('PC-07', 'Ryzen 5 5600, RTX 3060 12 GB, 16 GB de RAM, monitor 165 Hz', 'disponivel'),
  ('PC-08', 'Ryzen 5 5600, RTX 3060 12 GB, 16 GB de RAM, monitor 165 Hz', 'disponivel'),
  ('PC-09', 'Ryzen 7 7800X3D, RTX 4070 Super, 32 GB de RAM, monitor 240 Hz', 'disponivel'),
  ('PC-10', 'Ryzen 7 7800X3D, RTX 4070 Super, 32 GB de RAM, monitor 240 Hz', 'disponivel');
