# VIZIO SmartCast

Controle sus **televisores y barras de sonido VIZIO SmartCast** desde Gladys, en su red local:
encendido, volumen, silencio, entradas, aplicaciones, modos de imagen y de sonido, teclas del mando.
Sin nube ni cuenta VIZIO: Gladys habla directamente con la API SmartCast de cada dispositivo (la que
usa la aplicación móvil de VIZIO).

> Desarrollada sin el hardware: sus comentarios son bienvenidos. Esta integración se escribió a
> partir del protocolo documentado y de respuestas reales de televisores VIZIO publicadas por
> proyectos libres, sin pruebas en un televisor real por ahora. Díganos qué funciona y qué no:
> [github.com/guim31/gladys-vizio/issues](https://github.com/guim31/gladys-vizio/issues).

Esta integración no está afiliada a VIZIO, Inc. VIZIO y SmartCast son marcas de sus propietarios.

## Requisitos

- Un televisor VIZIO **SmartCast** (2016 y posteriores) o una barra de sonido, en la misma red local
  que Gladys.
- Gladys Assistant **5.1.0** o posterior.
- En el televisor, ajuste el modo de energía en **Inicio rápido** («Quick Start»; Menú, Sistema,
  Modo de energía). En **modo Eco**, un televisor en espera apaga su red: Gladys deja de verlo y no
  puede encenderlo, hasta que se encienda con su mando. La integración no usa Wake-on-LAN: VIZIO no
  lo documenta, y ningún informe muestra que despierte un televisor en modo Eco.
- Asigne una dirección IP fija a cada dispositivo en su router (recomendado).

## Instalación y configuración

1. En Gladys, abra **Integraciones**, luego **Instalar desde GitHub**, e instale
   `guim31/gladys-vizio`.
2. Encienda sus televisores y barras de sonido. La integración los busca en la red (mDNS, a través
   de Gladys) al arrancar y en cada **Búsqueda** de la pestaña Detección.
3. Un dispositivo que no se encuentra (otra red, mDNS bloqueado): escriba su dirección IP en
   **Direcciones (opcional)**, varias separadas por comas (`192.168.1.30, 192.168.1.31`).
4. Las barras de sonido no necesitan emparejamiento: aparecen enseguida en la pestaña Detección.
   Los televisores deben emparejarse primero (más abajo).
5. En la pestaña **Detección**, añada los dispositivos a Gladys.

Opciones:

- **Aplicaciones favoritas**: las aplicaciones de la lista **Aplicación** de cada televisor y, por
  defecto, del widget de accesos directos, por su nombre SmartCast (por defecto `Netflix, YouTube,
Prime Video, Disney+, Hulu, Apple TV+`, 12 como máximo). Los nombres son los del catálogo
  SmartCast de pyvizio (150 aplicaciones: Netflix, Prime Video, Disney+, Hulu, YouTube, YouTube TV,
  Max con el nombre «HBO Max», Peacock, Paramount+, Plex, Pluto TV, Tubi, Apple TV+…); un nombre
  que no está en el catálogo se indica en el estado de la integración.
- **Intervalo de actualización**: 10, 15 o 30 segundos.
- **Paso de volumen**: cambio de cada pulsación de Volumen + y Volumen −.
- **Idioma de los nombres de funciones**: los nombres de las funciones al añadir un dispositivo
  (después se quedan como están), y los textos de las listas y de los eventos de escena. Francés por
  defecto.

### Emparejar un televisor

Un televisor solo obedece a un cliente que conoce: muestra un PIN y da un token una vez introducido
el PIN. La integración guarda el token en su almacenamiento privado (`/data`), nunca en los
registros.

1. Encienda el televisor.
2. En la configuración de la integración, ejecute **Iniciar el emparejamiento**. El televisor
   muestra un PIN de 4 dígitos. Si hay varios televisores por emparejar, escriba la dirección del
   que desea emparejar en el campo de la acción.
3. Escriba el PIN en el campo de **Introducir el PIN** y ejecute la acción, en 5 minutos.
4. El televisor aparece en la pestaña Detección: añádalo.

El televisor cuenta entonces a Gladys entre sus dispositivos emparejados (con el nombre «Gladys»).
Un PIN incorrecto puede escribirse de nuevo mientras el televisor lo muestre. Emparejar de nuevo
sustituye el token. Tras restablecer el televisor, vuelva a emparejarlo.

**Probar la conexión** busca los dispositivos, lee cada uno e indica para cada uno lo que encuentra:
modelo, encendido o en espera, modo Eco, emparejamiento necesario, una dirección que no responde.

## Dispositivos y funciones

Un dispositivo por televisor o barra de sonido, identificado por su número de serie: un cambio de
dirección IP (DHCP) se sigue, el dispositivo sigue siendo el mismo.

### Televisor

| Función                       | Qué hace                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Encendido                     | Encendido o en espera; enciende o apaga el televisor (Inicio rápido necesario para encenderlo).      |
| Volumen                       | De 0 a 100, como en el televisor.                                                                    |
| Bajar volumen / Subir volumen | Botones, según el paso de volumen de la configuración.                                               |
| Silenciar                     | Botón: silencia o restablece el sonido (el estado se ve en el widget y en En reproducción).          |
| Entrada                       | Lista de las entradas del televisor, con los nombres definidos en él (SmartCast, HDMI-1, PS5…).      |
| Aplicación                    | Inicio de SmartCast, las aplicaciones favoritas y «Otra» (una entrada, o una app fuera de la lista). |
| En reproducción               | Texto: la aplicación (Netflix…), la entrada, o Apagado.                                              |
| Modo de imagen                | Lista de los modos de imagen del televisor (Vivid, Calibrated, Game…), cuando los tiene.             |
| Bajar canal / Subir canal     | Botones, en los televisores con sintonizador.                                                        |

### Barra de sonido

Encendido, Volumen (de 0 a 31 en la mayoría de las barras de sonido, leído del dispositivo), Bajar
volumen, Subir volumen, Silenciar, Entrada (HDMI, Bluetooth, óptica…), En reproducción (la entrada)
y **Modo de sonido** (el ecualizador de la barra de sonido: Music, Movie…) cuando lo tiene.

Los nombres de las funciones siguen la opción **Idioma de los nombres de funciones**: Encendido,
Volumen, Bajar volumen, Subir volumen, Silenciar, Entrada, Aplicación, En reproducción, Modo de
imagen, Modo de sonido, Bajar canal, Subir canal.

## Widgets del panel

- **Mando VIZIO**: estado del dispositivo, lo que se reproduce, volumen, y los botones de
  encendido, Volumen −, Volumen + y Silenciar.
- **Accesos VIZIO**: cuatro aplicaciones o entradas favoritas, abiertas con un toque; el televisor
  se enciende primero si hace falta. Escriba sus nombres en la configuración del widget (`Netflix`,
  `HDMI-1`, `PS5`); todos vacíos: las aplicaciones favoritas de la configuración (las entradas en
  una barra de sonido). La que está en primer plano lleva una marca.
- **Teclas VIZIO**: cuatro teclas del mando a elegir (flechas por defecto; añada un segundo widget
  para OK, Volver, Inicio, Menú…). Una barra de sonido solo tiene algunas.

Cada widget sigue un dispositivo, elegido en su configuración (vacío: el primero).

## Disparador de escena

**TV: aplicación o entrada cambiada** se dispara cuando algo nuevo pasa a primer plano, encendido
incluido: una aplicación (Netflix, YouTube…) o una entrada (una consola por HDMI). Filtros: el
dispositivo, el tipo (aplicación o entrada) y el nombre, exactamente como lo muestra la función
**En reproducción** (`Netflix`, `HDMI-1`, `PS5`). Se detecta dentro del intervalo de
actualización. Variables: el nombre del dispositivo, el tipo (`app` o `input`) y el nombre.

El encendido y el apagado no necesitan disparador: use el estado de la función **Encendido**.

## Acciones de escena

- **Abrir una aplicación en el televisor**: por su nombre SmartCast (`Netflix`, `Prime Video`,
  «disney plus» también funciona). Enciende primero el televisor si hace falta. Devuelve el nombre
  de la aplicación abierta.
- **Elegir una entrada**: por su nombre o el nombre definido en el televisor (`HDMI-1`, `PS5`).
  Enciende primero el dispositivo si hace falta.
- **Enviar una tecla del mando**: flechas, OK, Volver, Inicio, Menú, Info, Reproducir, Pausa,
  Retroceder, Avanzar, Volumen, Silenciar, Canal, Canal anterior, Entrada siguiente; repetida hasta
  10 veces.

## Ejemplos de escenas

- **Noche de cine**: disparador **TV: aplicación o entrada cambiada**, tipo Aplicación, nombre
  `Netflix` → bajar las luces del salón al 20 % y cerrar las persianas.
- **Hora de jugar**: disparador **TV: aplicación o entrada cambiada**, tipo Entrada, nombre `PS5` →
  poner el modo de imagen en Game (función Modo de imagen) y encender la luz ambiental.
- **Buenas noches**: a las 23:30, si el **Encendido** del televisor está activo → enviar una
  notificación y apagar el televisor 15 minutos después.
- **Noticias de la mañana**: a las 7:00 entre semana → **Abrir una aplicación en el televisor**
  `YouTube TV`, y luego poner el volumen en 15.

## Actualización y red

La integración lee cada dispositivo con su propio temporizador, al intervalo elegido: una
solicitud para el estado de un televisor en espera; encendido, de dos a cuatro solicitudes
(encendido, entrada y aplicación, ajustes de sonido, modo de imagen). Un dispositivo que no responde
(modo Eco) cuesta un intento de conexión por intervalo, y no se indica como error. Los estados solo
se envían a Gladys cuando cambian, y de nuevo cada 6 horas. Las entradas se vuelven a leer cada 30
minutos, los límites y listas de los ajustes una vez al día.

La API SmartCast es local, sin cuota; su servidor es pequeño, por eso la integración envía una sola
solicitud a la vez a cada dispositivo. Todo se queda en su red: HTTPS en el puerto 7345 o 9000, con
el certificado autofirmado del dispositivo.

## Solución de problemas

- **Ningún dispositivo encontrado**: el dispositivo debe estar encendido (o en espera con Inicio
  rápido) y en la misma red que Gladys. Si no, escriba su dirección en **Direcciones (opcional)** y
  ejecute **Probar la conexión**.
- **«Emparejamiento necesario»** en el estado de la integración: ejecute **Iniciar el
  emparejamiento** con el televisor encendido.
- **«El televisor ya no acepta Gladys»**: el televisor olvidó el token (restablecimiento,
  actualización): vuelva a emparejarlo.
- **El televisor no se enciende desde Gladys**: está en modo Eco; elija Inicio rápido en el
  televisor.
- **PIN incorrecto**: escriba de nuevo el PIN que se muestra, o ejecute otra vez **Iniciar el
  emparejamiento** para obtener uno nuevo. Tras demasiados intentos, el televisor rechaza el
  emparejamiento durante un tiempo.
- **Una aplicación no se abre, o aparece como «Aplicación desconocida»**: no está en el catálogo
  SmartCast, o su identificador cambió. Indíquenos su nombre en una issue.
- **Registros detallados**: arranque el contenedor con `LOG_LEVEL=debug`.

## Limitaciones

- Desarrollada sin el hardware: las solicitudes siguen pyvizio y vizaio, y las capturas de un
  televisor real que publicaron, pero esta integración aún no ha funcionado frente a un dispositivo
  VIZIO real.
- Un televisor en modo Eco no se puede ver ni encender mientras está en espera.
- La lista de aplicaciones es el catálogo SmartCast de pyvizio: un televisor no tiene ninguna
  solicitud que liste sus aplicaciones instaladas.
- El estado del silencio se muestra, pero Silenciar es un botón de alternancia (los televisores
  SmartCast tratan cualquier tecla de silencio como una alternancia).
- El modo de imagen y el modo de sonido dependen del firmware: solo aparecen si el dispositivo los
  ofrece.
- VIZIO solo vende dispositivos SmartCast en Norteamérica.
