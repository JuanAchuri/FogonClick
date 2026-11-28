-- crear la BD
CREATE DATABASE restaurante;

--Ingresar a la BD
\c restaurante

--Crear las tablas de la bd
CREATE TABLE unidad_medida (
    id_unidad SERIAL,
    nombre varchar(100) NOT NULL,
    abreviatura varchar(10) NOT NULL,
    PRIMARY KEY (id_unidad)
);

CREATE TABLE proveedor (
    id_proveedor SERIAL,
    nombre varchar(100) NOT NULL,
    correo varchar(100),
    telefono varchar(30) NOT NULL,
    nit varchar(50),
    PRIMARY KEY (id_proveedor)
);

CREATE TABLE categoria (
    id_categoria SERIAL,
    nombre varchar(100) NOT NULL,
    PRIMARY KEY (id_categoria)
);

CREATE TABLE rol (
    id_rol SERIAL,
    rol varchar(50) NOT NULL UNIQUE,
    PRIMARY KEY (id_rol)
);

CREATE TABLE usuario (
    id_usuario SERIAL,
    correo varchar(100) NOT NULL UNIQUE,
    password varchar(255) NOT NULL,
    PRIMARY KEY (id_usuario)
);

CREATE TABLE estado_empleado (
    id_estadoemp SERIAL,
    estado varchar(50) NOT NULL,
    PRIMARY KEY (id_estadoemp)
);

CREATE TABLE estado_pedido (
    id_estadoped SERIAL,
    estado varchar(50) NOT NULL,
    PRIMARY KEY (id_estadoped)
);

CREATE TABLE metodo_pago (
    id_metodo SERIAL,
    metodo varchar(50) NOT NULL,
    PRIMARY KEY (id_metodo)
);

CREATE TABLE cliente (
    id_cliente SERIAL,
    nombre varchar(100) NOT NULL,
    cedula varchar(50) NOT NULL,
    correo varchar(100) NOT NULL,
    PRIMARY KEY (id_cliente)
);

CREATE TABLE empresa (
    id_empresa SERIAL,
    tipo_organizacion varchar(50) NOT NULL,
    razon_social varchar(150) NOT NULL,
    nom_comercial varchar(150) NOT NULL UNIQUE,
    nom_dueno varchar(100) NOT NULL,
    cod_registro_mercantil varchar(50),
    act_economica varchar(50) NOT NULL,
    telefono varchar(30) NOT NULL,
    correo varchar(100) NOT NULL UNIQUE,
    direccion text NOT NULL,
    cod_tributo varchar(20) NOT NULL,
    cod_municipio varchar(20) NOT NULL,
    responsabilidades_fiscales text NOT NULL,
    nit varchar(50) NOT NULL UNIQUE,
    PRIMARY KEY (id_empresa)
);

CREATE TABLE empleado (
    id_empleado SERIAL,
    nombre varchar(100) NOT NULL,
    telefono varchar(30) NOT NULL,
    cedula varchar(50) NOT NULL UNIQUE,
    id_rol int NOT NULL,
    id_estadoemp int NOT NULL,
    id_usuario int NOT NULL,
    id_empresa int NOT NULL,
    PRIMARY KEY (id_empleado),
    FOREIGN KEY (id_rol) REFERENCES rol(id_rol) ON DELETE RESTRICT,
    FOREIGN KEY (id_estadoemp) REFERENCES estado_empleado(id_estadoemp) ON DELETE RESTRICT,
    FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario) ON DELETE RESTRICT,
    FOREIGN KEY (id_empresa) REFERENCES empresa(id_empresa) ON DELETE RESTRICT
);

CREATE TABLE insumo (
    id_insumo SERIAL,
    nombre varchar(100) NOT NULL,
    stock numeric NOT NULL DEFAULT 0 CHECK (stock >= 0),
    fec_vencimiento date NOT NULL,
    costo numeric NOT NULL CHECK (costo >= 0),
    id_proveedor int,
    id_unidad int NOT NULL,
    PRIMARY KEY (id_insumo),
    FOREIGN KEY (id_proveedor) REFERENCES proveedor(id_proveedor) ON DELETE SET NULL,
    FOREIGN KEY (id_unidad) REFERENCES unidad_medida(id_unidad) ON DELETE RESTRICT
);

CREATE TABLE producto (
    id_producto SERIAL,
    nombre varchar(100) NOT NULL,
    precio numeric NOT NULL CHECK (precio >= 0),
    descripcion text NOT NULL,
    url_foto text NOT NULL,
    id_categoria int,
    PRIMARY KEY (id_producto),
    FOREIGN KEY (id_categoria) REFERENCES categoria(id_categoria) ON DELETE SET NULL
);

CREATE TABLE receta (
    id_receta SERIAL,
    nombre varchar(100) NOT NULL,
    descripcion text NOT NULL,
    id_producto int NOT NULL,
    PRIMARY KEY (id_receta),
    FOREIGN KEY (id_producto) REFERENCES producto(id_producto) ON DELETE CASCADE
);

CREATE TABLE detalle_receta (
    id_insumo int NOT NULL,
    id_receta int NOT NULL,
    cantidad numeric NOT NULL CHECK (cantidad > 0),
    PRIMARY KEY (id_insumo, id_receta),
    FOREIGN KEY (id_insumo) REFERENCES insumo(id_insumo) ON DELETE RESTRICT,
    FOREIGN KEY (id_receta) REFERENCES receta(id_receta) ON DELETE CASCADE
);

CREATE TABLE pedido (
    id_pedido SERIAL,
    fec_creacion timestamp with time zone NOT NULL DEFAULT now(),
    id_empleado int NOT NULL,
    id_estadoped int NOT NULL,
    id_cliente int NOT NULL,
    PRIMARY KEY (id_pedido),
    FOREIGN KEY (id_empleado) REFERENCES empleado(id_empleado) ON DELETE RESTRICT,
    FOREIGN KEY (id_estadoped) REFERENCES estado_pedido(id_estadoped) ON DELETE RESTRICT,
    FOREIGN KEY (id_cliente) REFERENCES cliente(id_cliente) ON DELETE RESTRICT
);

CREATE TABLE detalle_pedido (
    id_pedido int NOT NULL,
    id_producto int NOT NULL,
    cantidad int NOT NULL CHECK (cantidad > 0),
    PRIMARY KEY (id_pedido, id_producto),
    FOREIGN KEY (id_pedido) REFERENCES pedido(id_pedido) ON DELETE CASCADE,
    FOREIGN KEY (id_producto) REFERENCES producto(id_producto) ON DELETE CASCADE
);

CREATE TABLE factura (
    id_factura SERIAL,
    total numeric NOT NULL CHECK (total >= 0),
    fec_creacion timestamp with time zone NOT NULL DEFAULT now(),
    url_factura text,
    id_pedido int NOT NULL,
    id_empresa int NOT NULL,
    PRIMARY KEY (id_factura),
    FOREIGN KEY (id_pedido) REFERENCES pedido(id_pedido) ON DELETE RESTRICT,
    FOREIGN KEY (id_empresa) REFERENCES empresa(id_empresa) ON DELETE RESTRICT
);

--Creamos una vista de las facturas del año 2025
CREATE OR REPLACE VIEW vista_facturas_2025 AS
SELECT id_factura, total, fec_creacion, url_factura, id_pedido, id_empresa
FROM factura
WHERE EXTRACT(YEAR FROM fec_creacion) = 2025;

CREATE TABLE pago (
    id_pago SERIAL,
    monto numeric NOT NULL CHECK (monto >= 0),
    fec_creacion timestamp with time zone NOT NULL DEFAULT now(),
    id_pedido int NOT NULL,
    id_metodo int NOT NULL,
    PRIMARY KEY (id_pago),
    FOREIGN KEY (id_pedido) REFERENCES pedido(id_pedido) ON DELETE RESTRICT,
    FOREIGN KEY (id_metodo) REFERENCES metodo_pago(id_metodo) ON DELETE RESTRICT
);

--Insertar datos basicos
INSERT INTO rol (rol) VALUES ('Administrador'), ('Cocina'), ('Caja');
INSERT INTO estado_empleado (estado) VALUES ('activo'), ('retirado'), ('suspendido'), ('vacaciones'), ('discapacitado');
INSERT INTO unidad_medida (nombre, abreviatura) VALUES ('gramos', 'g'), ('kilogramos', 'kg'), ('mililitros', 'ml'), ('litros', 'l'), ('unidades', 'u');
INSERT INTO estado_pedido (estado) VALUES ('pendiente'), ('preparacion'), ('completado'), ('cancelado');
INSERT INTO metodo_pago (metodo) VALUES ('efectivo'), ('factus_pay_qr');

--Creamos el esquema para los datos eliminados
CREATE SCHEMA eliminados;

--Creamos las tablas para los datos eliminados
CREATE TABLE eliminados.proveedor (
    id_eliminado SERIAL,
    id_proveedor int NOT NULL,
    nombre varchar(100) NOT NULL,
    correo varchar(100),
    telefono varchar(30) NOT NULL,
    nit varchar(50),
    fecha_eliminacion timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (id_eliminado)
);

--Creamos la funcion (procedimiento) para el trigger de proveedor
CREATE OR REPLACE FUNCTION registrar_proveedor_eliminado()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO eliminados.proveedor (
        id_proveedor,
        nombre,
        correo,
        telefono,
        nit
    )
    VALUES (
        OLD.id_proveedor,
        OLD.nombre,
        OLD.correo,
        OLD.telefono,
        OLD.nit
    );

    RETURN OLD;
END;
$$ 
LANGUAGE plpgsql;

--Creamos el trigger sobre la tabla proveedor
CREATE TRIGGER tr_before_delete_proveedor
BEFORE DELETE ON proveedor
FOR EACH ROW
EXECUTE FUNCTION registrar_proveedor_eliminado();
