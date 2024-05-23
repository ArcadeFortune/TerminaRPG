await import ('node:process');
const os = await import('node:os')
const net = await import('node:net')
const dgram = await import('node:dgram');
const readline = await import('node:readline');
const { EventEmitter } = await import('node:events');

if (!process.stdin.isTTY) {
  console.log('Not in a terminal, exiting...');
  process.exit(1);
}

process.on('exit', () => {
  // console.clear()
  console.log('leaving...')
})

//get ip address to bind local server to so others can join it in LAN
function get_ip_address(family='IPv4') {
  let ip_address = '127.0.0.1'
  let found = false

  try {
    const network_interfaces = os.networkInterfaces();

    const interface_arr = Object.keys(network_interfaces)
    for (let i = 0; i < interface_arr.length; i++) {
      const address_arr = network_interfaces[interface_arr[i]]
      for (let j = 0; j < address_arr.length; j++) {
        if (address_arr[j].family === family) {
          ip_address = address_arr[j].address
          found = true
        }
        if (found) break
      }
      if (found) break
    }

  }
  catch (error) {
    console.log('You must be playing on an android phone :)')
  }
  return ip_address
}

//global variables and constants
const TITLE = `Welcome to TerminaRPG
           ▔▔▔▔▔▔▔▔▔▔`
const DEFAULT_GAME_SERVER_ADDRESS = get_ip_address() //changes when connecting to remote server
const DEFAULT_GAME_SERVER_PORT = 49152 //any number i want
const MULTICAST_ADDRESS = '224.69.69.69'
const DEFAULT_SCREEN_WIDTH = process.stdout.columns
const DEFAULT_SCREEN_HEIGHT = process.stdout.rows
const DEFAULT_CHAT_HEIGHT = 5
const MAP_WIDTH = 30
const MAP_HEIGHT = 10
const TILE_SIZE = 2;
const INVINCIBILITY_FRAMES = 300
const DELIMITER = 'µ'



// Server code //

function DEBUG(...text) {
  if (false) console.log(...text);
}

class Server extends EventEmitter {
  constructor(port, address='localhost', server_type='Server') {
    super()
    this.port = port
    this.address = address
    this.server_type = server_type + '/Server'
    //start the server as soon as this is initialized
    this.server = net.createServer((socket) => {
      DEBUG('New client connected');
      socket.setEncoding('utf-8');
      socket.on('data', (data) => data.split(DELIMITER).slice(0, -1).forEach(task => this.emit('message', JSON.parse(task), socket)))

      socket.on('error', (error) => {
        // DEBUG('Error from the serverside: ', error)
      })
      socket.on('close', () => {
        this.emit('close', socket)
      })
    })

    this.server.on('connection', (socket) => {
      this.emit('connection', socket)
    })

    this.server.on('close', () => {
      DEBUG(`
        \r${this.server_type} shutting down...
      `);
    })

    this.server.listen(this.port, this.address, () => {
      DEBUG(`
        \r${this.server_type} started on:
        address: ${this.address}
        port: ${this.port}
      `);
      this.emit('start')
    })
  }
}

class Multicast extends EventEmitter {
  constructor(type='server') {
    super()
    this.type = type
    this.server = dgram.createSocket('udp4');
    this.server.on('error', (err) => {
      DEBUG(`server error:\n${err.stack}`);
      this.server.close();
    });
    this.server.on('message', (msg, rinfo) => {
      DEBUG(`${this.type} got: ${msg} from ${rinfo.address}:${rinfo.port}`);
      this.emit('message', msg, rinfo)
    })
  }
  listen(cb=()=>{}) {
    let port = 0; //any port
    if (this.type === 'server') port = DEFAULT_GAME_SERVER_PORT
    this.server.bind(port, undefined, () => {
      this.server.setBroadcast(true);
      this.server.setMulticastTTL(128);
      this.server.addMembership(MULTICAST_ADDRESS);
      const address = this.server.address();
      DEBUG(`${this.type} listening ${address.address}:${address.port}`)
      cb()
    });
  }
  send(message) {
    //broadcast message to all servers
    DEBUG(`sending ${message} to all servers at ${MULTICAST_ADDRESS}:${DEFAULT_GAME_SERVER_PORT}`);
    this.server.send(message, DEFAULT_GAME_SERVER_PORT, MULTICAST_ADDRESS);
  }
  send_to_client(message, port, address) {
    //send message to specific client
    DEBUG(`sending ${message} to client at ${address}:${port}`);
    this.server.send(message, port, address);
  }
  close() {
    this.server.close();
  }
}

class Entity {
  constructor() {
    this.is_entity = false
    this.damaged = false
    this.health = 0
  }
}

class TheLiving extends Entity {
  constructor() {
    super()
    this.is_entity = true
    this.default_health = 0
    this.default_strength = 0
    this.health = 0
    this.strength = 0;
    this.last_attack = Date.now() //timestamp of when the last attack was
    this.kills = 0
    this.deaths = 0
  }  
  reset() {
    this.strength = this.default_strength
    this.health = this.default_health
  }
}

class Player extends TheLiving {
  constructor() {
    super()
    this.default_health = 10
    this.default_strength = 1
    this.health = this.default_health
    this.strength = this.default_strength
    this.position = {}
    this.number = 0
  }
  toString() {
    return JSON.stringify(this.number)
  }
}

class Zombie extends TheLiving {
  constructor(x, y) {
    super()
    this.default_strength = 3
    this.default_health = 3
    this.health = this.default_health
    this.strength = this.default_strength
    this.position = {x, y}
  }
  toString() {
    return 'Z'
  }
}

class Ground extends Entity {
  constructor() {
    super()
    this.strength = -Infinity;
    this.health = -Infinity
  }
  toString() {
    return ' '
  }
}

class Wall extends Entity {
  constructor() {
    super()
    this.strength = Infinity;
    this.health = Infinity
  }
  toString() {
    return '#'
  }
}

class Scoreboard {
  constructor() {
    this.players = {}
  }
  add(player) {
    this.players[player.toString()] = {
      kills: player.kills || 0, 
      deaths: player.deaths || 0
    }
  }
  remove(player) {
    delete this.players[player.toString()]
  }
  increase_kills(player) {
    this.players[player.toString()].kills++
  }
  decrease_kils(player) {
    this.players[player.toString()].deaths++
  }
  toString() {
    return this.players
  }
}

class Game {
  constructor() {
    this.event = new EventEmitter();
    this.map = this.generate_map(MAP_WIDTH, MAP_HEIGHT)
    this.players = []
    this.scoreboard = new Scoreboard()
  }
  generate_map(width, height) {
    const map = []
    for (let i = 0; i < height; i++) {
      const row = []
      for (let j = 0; j < width; j++) {
        if (Math.random() > 0.8 || i === 0 || i === height-1 || j === 0 || j === width-1) {
          row.push(new Wall())
        } else {
          //spawn zombie
          if (Math.random() > 0.9) {
            row.push(new Zombie(j, i))
          } else {
            row.push(new Ground())
          }
        }
      }
      map.push(row)
    }
    return map
  }
  string_map() {
    //return a 2 dimentional array of the map
    const map = []
    for (let i = 0; i < this.map.length; i++) {
      let row = ''
      for (let j = 0; j < this.map[i].length; j++) {
        row += this.map[i][j].toString()
      }
      map.push(row)
    }    
    return map
  }
  join(player) {
    let y;
    let x;
    do {
      //get a random position on the map
      y = Math.floor(Math.random() * this.map.length)
      x = Math.floor(Math.random() * this.map[0].length)
    } while (!(this.map[y][x] instanceof Ground))
    //try again until it finds a ground cell

    //add the player to the game
    this.players.push(player)
    this.map[y][x] = player
    player.position = {x, y}

    //give the player a number if he doesn't have one
    if (!player.number) {
      for (let n = 1; n <= this.players.length + 1; n++) {
        if (this.players.every((player) => player.number !== n)) {
          player.number = n
          break
        }
      }
    }

    //add him to the scoreboard with the kills and deaths
    this.scoreboard.add(player)

    //notify the other players
    this.event.emit('happening', { 
      type: 'join',
      data: player.toString(),
    })

    this.event.emit('happening', {
      type: 'changes', 
      data: [
        { x, y, what: player.toString() }
      ],
    })

    this.event.emit('happening', { 
      type: 'scoreboard', 
      data: this.scoreboard.toString()
    })
  }
  async move(entity, action, direction) {
    // console.table(this.players, ['kills', 'deaths']);
    let legal = false
    if (!entity.position) return
    
    // if its a zombie attacking, delay the logic
    if (entity instanceof Zombie) await new Promise(resolve => setTimeout(() => {resolve()}, INVINCIBILITY_FRAMES))
    const i = entity.position.y
    const j = entity.position.x
    let new_i = i
    let new_j = j

    switch (direction) {
      case 'N':
        new_i = i-1
        //check for the boundries
        if (new_i >= 0) {
          legal = true
          if (action === 'move') {
            //only if the player is stronger than the cell, he can move there
            if (this.map[new_i][new_j].strength < this.map[i][j].strength) {
              this.map[i][j].position.y--
            } else legal = false
          }
        }
        break;
      case 'S':
        new_i = i+1
        //check for the boundries
        if (new_i < this.map.length) {
          legal = true
          if (action === 'move') {
            //only if the player is stronger than the cell
            if (this.map[new_i][new_j].strength < this.map[i][j].strength) {
              this.map[i][j].position.y++
            } else legal = false
          }
        }
        break;
      case 'W':
        new_j = j-1
        //check for the boundries
        if (new_j >= 0) {
          legal = true
          if (action === 'move') {
            //only if the player is stronger than the cell
            if (this.map[new_i][new_j].strength < this.map[i][j].strength) {
              this.map[i][j].position.x--
            } else legal = false
          }
        }
        break;
      case 'E':
        new_j = j+1
        //check for the boundries
        if (new_j < this.map[i].length) {
          legal = true
          if (action === 'move') {
            //only if the player is stronger than the cell
            if (this.map[new_i][new_j].strength < this.map[i][j].strength) {
              legal = true
              this.map[i][j].position.x++
            } else legal = false
          } 
        }
        break;
      case 'NW':
        new_i = i-1
        new_j = j-1
        //check for the boundries
        if (new_i >= 0 && new_j >= 0) legal = true
        else legal = false
        break;
      case 'NE':
        new_i = i-1
        new_j = j+1
        //check for the boundries
        if (new_i >= 0 && new_j < this.map[i].length) legal = true
        else legal = false
        break;
      case 'SW':
        new_i = i+1
        new_j = j-1
        //check for the boundries
        if (new_i < this.map.length && new_j >= 0) legal = true
        else legal = false
        break;
      case 'SE':
        new_i = i+1
        new_j = j+1
        //check for the boundries
        if (new_i < this.map.length && new_j < this.map[i].length) legal = true
        else legal = false
        break;
      default:
        DEBUG('Unkown direction:', direction);
        break;
    }

    if (!legal) {
      //handle illegal movements, do nothing
      if (action === 'move') return
      if (action === 'attack') return
    }

    if (action === 'move') {
      //move logic that would be repetetiv
      this.map[new_i][new_j].damaged = false
      const temp = this.map[i][j]
      this.map[i][j] = this.map[new_i][new_j] //new_i & j is the player
      this.map[new_i][new_j] = temp 

      //instantly update on player move.
      this.event.emit('happening', { type: 'changes', data: [
        { x: j, y: i, what: ' ' }, 
        { x: new_j, y: new_i, what: entity.toString() }
      ]})

      let found = false
      //check in a 3x3 radius if a zombie is there
      for (let y = new_i-1; y <= new_i+1; y++) {
        for (let x = new_j-1; x <= new_j+1; x++) {
          if (this.map[y][x] instanceof Zombie) {
            //check what direction the zombie needs to attack
            if (x === new_j && y > new_i) this.move(this.map[y][x], 'attack', 'N')
            if (x === new_j && y < new_i) this.move(this.map[y][x], 'attack', 'S')
            if (y === new_i && x > new_j) this.move(this.map[y][x], 'attack', 'W')
            if (y === new_i && x < new_j) this.move(this.map[y][x], 'attack', 'E')
            if (x > new_j && y > new_i) this.move(this.map[y][x], 'attack', 'NW')
            if (x > new_j && y < new_i) this.move(this.map[y][x], 'attack', 'SW')
            if (x < new_j && y > new_i) this.move(this.map[y][x], 'attack', 'NE')
            if (x < new_j && y < new_i) this.move(this.map[y][x], 'attack', 'SE')
            found = true
          }
          if (found) break
        }
        if (found) break
      }
    }

    if (action === 'attack') {
      //attack logic
      //cannot attack right after the last attack
      if (entity.last_attack > Date.now() - INVINCIBILITY_FRAMES) return
      //refresh the timestamp of the last attack
      entity.last_attack = Date.now()

      const enemy = this.map[new_i][new_j]
      //cannot attack already attacked entities, because of invincibility frames
      if (enemy.damaged === false) {
        //damage them
        enemy.health -= entity.strength
        enemy.damaged = true

        //if entity died
        if (enemy.health <= 0 && !(enemy instanceof Ground)) {
          this.kill(enemy)
          //if a player died
          if (enemy instanceof Player) {
            //update the kill counter for the victim
            enemy.deaths++
            this.scoreboard.decrease_kils(enemy)

            //reset the player (does not reset the kills though)
            enemy.reset()

            //if it was a player kill
            if (entity instanceof Player) {
              //update the kill counter for the killer
              entity.kills++
              this.scoreboard.increase_kills(entity)
            }

            //notify the other players
            this.event.emit('log', `Player ${enemy} died`)
            this.event.emit('happening', { type: 'scoreboard', data: this.scoreboard.toString() })
            this.event.emit('happening', { type: 'kill', killer: entity.toString(), victim: enemy.toString()})
          }
        } else {
          //update the damage frames to the players
          this.event.emit('happening', { 
            type: 'changes', 
            data: [
              { x: new_j, y: new_i, what: 'd'+this.map[new_i][new_j].toString() }
            ],
          })
          //after the INVINCIBILITY_FRAMES
          setTimeout(() => {
            //reset, the entity is no longer damaged, and can be attacked
            enemy.damaged = false          
            //also update the map
            this.event.emit('happening', { type: 'changes', data: [
              { x: new_j, y: new_i, what: this.map[new_i][new_j].toString() }
            ]})
          }, INVINCIBILITY_FRAMES)
        }
      }
    }
  }
  kill(entity) {
    const { x, y } = entity.position
    //if the entity is not there, do nothing
    if (this.map[y][x] !== entity) return
    //update the death of the entity
    this.event.emit('happening', { type: 'changes', data: [
      { x: x, y: y, what: 'f'+entity.toString() }
    ]})
    //kill them
    this.map[y][x] = new Ground()
    
    //after the INVINCIBILITY_FRAMES
    setTimeout(() => {
      //reset, the entity is no longer damaged, and can be attacked
      entity.damaged = false          
      //also update the map
      this.event.emit('happening', { type: 'changes', data: [
        { x: x, y: y, what: this.map[y][x].toString() }
      ]})
    }, INVINCIBILITY_FRAMES)
  }
}

//function to start game & game server
function start_game() {
  console.clear()
  DEBUG('loading')
  //initialize the game
  const game = new Game()

  //no code

  //initialize the game's server
  const game_server = new Server(DEFAULT_GAME_SERVER_PORT, DEFAULT_GAME_SERVER_ADDRESS, 'GameService')

  game_server.on('start', () => {
    // DEBUG('Game server started')
    display.player_connect()
  })

  //when a new player has connected to our server...
  game_server.on('connection', (socket) => {
    //we set up events to send information towards that socket
    //this whole game works on events
    game.event.on('happening', (happening) => {
      if (!socket.player) return

      const obj = { ...happening, player: socket.player}
      //after a socket disconnects, all the events will still be emitted

      socket.write(JSON.stringify(obj) + DELIMITER)
    })
    game.event.on('log', (message_to_log) => {
      DEBUG(message_to_log)
      if (!socket.player) return
      socket.write(JSON.stringify({type: 'log', data: message_to_log}) + DELIMITER)
    })

    //and might aswell save the sockets player position
    const player = new Player()
    socket.player = player
  })

  game_server.on('close', (socket) => {
    //delete that player from the system
    game.players = game.players.filter((player) => player.number !== socket.player.number)
    game.scoreboard.remove(socket.player.toString())
    game.kill(socket.player)
    //broadcast to everyone that someone left
    game.event.emit('log', `Player ${socket.player} left`)
    game.event.emit('happening', { 
      type: 'scoreboard', 
      data: game.scoreboard.toString()
    })
    //delete the player from the socket
    delete socket.player
  })

  //when a player sends a message
  game_server.on('message', (message, socket) => {
    // DEBUG(`Got message from player ${socket.player}:`, message);
    switch (message.type) {
      case 'join':
        //register the player
        game.join(socket.player)
        
        //send the initial map to the player
        socket.write(JSON.stringify({type: 'map', data: game.string_map(), player: socket.player}) + DELIMITER)
        break;
      case 'move':
        game.move(socket.player, message.data.action, message.data.direction)
        // game.move(message.data.direction, socket.player)
        break
      default:
        DEBUG('unknown message type:', message);
    }
  })
  
  //initialize the discovery service for the game
  const discovery = new Multicast('server')

  //when a player is looking for a game
  discovery.on('message', (msg, client_info) => {
    switch (msg.toString()) {
      case 'LFG':
        discovery.send_to_client('i am here', client_info.port, client_info.address)
        break;
      default:
        DEBUG('unknown message:', msg.toString());
        break;
    }
  });
  discovery.listen()
}


// Client code //

class Client extends EventEmitter {
  constructor(connect_to_port, connect_to_address, client_type='Client') {
    super()
    this.port = connect_to_port
    this.address = connect_to_address
    this.socket_type = client_type + '/Client'

    //connect to the server as soon as this is initialized
    this.socket = net.createConnection({
      port: this.port,
      host: this.address,
      timeout: 500
    })
    
    this.socket.on('timeout', () => {
      this.emit('connection_timeout')
    })

    this.socket.on('error', (error) => {
      if (error.code === 'ECONNRESET') {
        this.emit('server_close')
      }
    })
    
    // this.socket.on('close', (intentional) => {
    // })
    
    this.socket.on('connect', () => {
      this.socket.removeAllListeners('timeout')
      this.emit('connect')
    })

    this.socket.on('data', (data) => {
      data = data.toString()
      data.split(DELIMITER).slice(0, -1).forEach(task => this.emit('message', JSON.parse(task)))
    })
  }

  close(intentional=false) {
    this.socket.destroy(intentional)
  }

  send(message, type) {
    if (!message || !type) return console.error('insufficent parameters')

    const full_message = {}
    full_message['type'] = type
    full_message['data'] = { ...message }

    this.socket.write(JSON.stringify(full_message) + DELIMITER)
  }
  
  action(key) {
    switch (key.name) {
      case 'w':
        this.send({direction: 'N', action: 'move'}, 'move')
        break;    
      case 's':
        this.send({direction: 'S', action: 'move'}, 'move')
        break;
      case 'a':
        this.send({direction: 'W', action: 'move'}, 'move')
        break;
      case 'd':
        this.send({direction: 'E', action: 'move'}, 'move')
        break;
      case 'up':
        this.send({direction: 'N', action: 'attack'}, 'move')
        break;
      case 'down':
        this.send({direction: 'S', action: 'attack'}, 'move')
        break;
      case 'left':
        this.send({direction: 'W', action: 'attack'}, 'move')
        break;
      case 'right':
        this.send({direction: 'E', action: 'attack'}, 'move')
        break;
      case 'e':
        display.log_ip()
        break;
      default:
        process.stdout.write(`Button ${key.name} unknown.             \r`)
        break;
    }
  }
}

class Display {
  constructor() {
    this.screen_width = DEFAULT_SCREEN_WIDTH
    this.screen_height = DEFAULT_SCREEN_HEIGHT
    this.chat_height = DEFAULT_CHAT_HEIGHT
    this.is_in_intro = false
    this.is_in_death_screen = false
    this.scoreboard = []
    this.to_log = []
    this.menu_title = ''
    this.op_animation = null //interval id for 'Nevermind...' animation
    this.player_client = null //the client to connect to the server
    this.player_multicast = null //the multicast to find the server
    this.game_server_port = DEFAULT_GAME_SERVER_PORT
    this.game_server_address = DEFAULT_GAME_SERVER_ADDRESS
    this.current_options = []
    this.current_index = 0
    this.COLORS = {
      reset: '\x1b[0m',
      message: '\x1b[38;5;45m',
      placeholder: '\x1b[38;5;244m',
      pure_white: '\x1b[38;5;255m',
      error: '\x1b[38;5;9m',
      'Z': '\x1b[48;5;34mZ', //zombie
      ' ': '\x1b[48;5;0m ', //ground
      '#': '\x1b[48;5;15m\x1b[38;5;250m#', //wall

      'dZ': '\x1b[38;5;196m\x1b[48;5;34mZ', //damaged zombie
      'd ': '\x1b[38;5;196m/', //damaged ground
      'd#': '\x1b[48;5;15m\x1b[38;5;253m#', //damaged wall

      'fZ': '\x1b[38;5;196m\x1b[48;5;34mX', //final moments of zombie

      'd': '\x1b[38;5;196m~', //player damaged
      'f': '\x1b[38;5;196m0', //player killed
    };
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '',
    });

    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf-8');
  }  
  async menu(type) {
    const options = this.current_options
    const selected_option = this.current_index
    //inside the options are stored values of previous screen
    switch(type) {
      case 'main':
        //reset any ongoing clients
        this.player_client?.close(false)
        this.player_multicast?.close()

        this.menu_title = '\\\\ Main Menu //'
        this.current_options = [
          {id: 'play', name: 'Play game'},
          {id: 'play_online', name: 'Play online in LAN'},
          {id: 'settings', name: 'Settings'},
          {id: 'quit', name: 'Nevermind'},
        ],

        this.show(0)
      break;
      case 'play_online':
        this.menu_title = '\\\\ Play with friends //'
        this.current_options = [
          {id: 'play_remote', name: 'Join game via IP', type: 'select', input: true, placeholder: 'XXX.XXX.X.X'},
          {id: 'main', name: 'Return to menu'},
        ]

        //start to look for available servers
        this.player_multicast = new Multicast('client')
        this.player_multicast.listen(() => {
          this.player_multicast.send('LFG')
        })
        this.player_multicast.on('message', (msg, rinfo) => {
          //if a server is found, display it as an option
          let server_found = { 
            id: 'play_remote', 
            name: `Join ${rinfo.address}:${rinfo.port}`,
            value: rinfo.address,
          }
          this.current_options = [server_found, ...this.current_options]
          this.current_index = 0 //fixes selection bug with multiple available servers
          this.show(0)
        });
        
        this.show(0)
        break;
      case 'settings':
        this.menu_title = '\\\\ Settings //'
        this.current_options = [
          {id: 'screen_size', name: 'Change screen size'},
          {id: 'main', name: 'Return to menu'},
        ]
        this.show(0)
        break;
      case 'screen_size':
        this.menu_title = '\\\\ How much space do you have? //'
        this.current_options = [
          //ids here have to match their respective values, like: this.screen_width
          {id: 'screen_width', name: 'Width', type: 'slider', value: this.screen_width},
          {id: 'screen_height', name: 'Height', type: 'slider', value: this.screen_height},
          {id: 'chat_height', name: 'Chat Height', type: 'slider', value: this.chat_height},
          {id: 'screen_reset', name: 'Reset to default'},
          {id: 'settings', name: 'Return to settings'},
          {id: 'main', name: 'Return to menu'},
        ]
        this.show(0, true)
        break;
      case 'server_close':
        this.menu_title = '\\\\ The server closed //'
        this.current_options = [
          {id: 'main', name: 'Return to menu'},
          {id: 'quit', name: 'Nevermind'},
        ],
        this.show(0)
        break;
      case 'death_screen':
        this.menu_title = '\\\\ You died //'
        this.current_options = [
          {id: 'play_again_remote', name: 'Reconnect'},
          {id: 'main', name: 'Return to menu'},
          {id: 'quit', name: 'Nevermind'},
        ]
        this.show(0)
        break;
      //cases for when a button is clicked, that is not another menu
      case 'play':
        //reset the server address
        this.game_server_address = DEFAULT_GAME_SERVER_ADDRESS
        start_game()
        break;
      case 'play_remote':
        //get the values from the options
        const address_to_connect = options[selected_option].value
        //check for legit host
        if (net.isIP(address_to_connect) < 1) {
          options[selected_option].error = 'Impossible host address' + selected_option
          this.show()
          break;
        }
        // notify that it is connecting
        options[selected_option].message = 'Connecting...'
        this.show()

        //start game but with a remote server
        this.game_server_address = address_to_connect
        this.player_connect()
        break    
      case 'play_again_remote':
        this.player_join()
        break
      case 'screen_reset':
        this.screen_width = DEFAULT_SCREEN_WIDTH
        this.screen_height = DEFAULT_SCREEN_HEIGHT
        this.chat_height = DEFAULT_CHAT_HEIGHT
        this.show(0, true)
        break;
      case 'quit':
        console.clear()
        console.log('bye')
        process.exit(0)
      case 'death':
        this.is_in_death_screen = true
        this.intro('You died.', 'death_screen')
        break;
    }
  }
  show(index, screen_borders=false) {
    const options = this.current_options
    const selected_index = index ?? this.current_options[this.current_index] ? this.current_index : 0
    console.clear()
    //if we need to show the screen borders
    if (screen_borders) this.draw_border() 

    console.log(TITLE);
    console.log(this.menu_title);
    console.log();

    //render each of the options
    options.forEach((option, index) => {
      //set defaults
      if (!option.type) option.type = 'select'
      if (option.input && !option.value) option.value = ''

      //special animation for the 'Nevermind'
      if (option.id === 'quit' && index === selected_index) {
        process.stdout.write(`${this.COLORS.pure_white}> ${option.name}.         ${this.COLORS.reset}\r`)
        
        let i = 2
        this.op_animation = setInterval(() => {
          process.stdout.write(`${this.COLORS.pure_white}> ${options[selected_index].name}${'.'.repeat(i)}         ${this.COLORS.reset}\r`)
          if (i === 3) i = 0
          else i++
        }, 500)
      }
      //render the options
      else {
        if (index === selected_index) {
          console.log(this.COLORS.pure_white + '> ' + option.name + this.COLORS.reset); //highlight selected
        } else {
          //print the other option
          console.log(' ' + option.name);
        }

        //print stuff beneath an option
        if (index === selected_index && option.input) {
          process.stdout.write('  ') //margin
          console.log(option.value || this.COLORS.placeholder + (option.placeholder || '') + this.COLORS.reset);
        }
        if (index === selected_index && option.type === 'slider') {
          process.stdout.write(' ') //less margin for the symbols
          console.log(`${this.COLORS.pure_white}- ${this[options[selected_index].id]} +${this.COLORS.reset}`);
        }
        if (index === selected_index && option.message) {
          process.stdout.write('  ') //margin
          console.log(this.COLORS.message + option.message + this.COLORS.reset);
        }
        //should not show errors and messages at the same time
        else if (index === selected_index && option.error) {
          process.stdout.write('  ') //margin
          console.log(this.COLORS.error + option.error + this.COLORS.reset);
        }
      }
    })

    //clean up the animation
    if (options[selected_index].id !== 'quit') clearInterval(this.op_animation)
    

    process.stdin.removeAllListeners('keypress')
    process.stdin.on('keypress', (str, key) => {
      if (key.ctrl && key.name === 'c') {
        process.exit();
      }
      else if (key.name === 'down') {
        if (selected_index < options.length - 1) {
          options[selected_index].error = '' //cleanse its error
          this.current_index = selected_index+1
          this.show(selected_index+1, screen_borders)
        }
      }
      else if (key.name === 'up') {
        if (selected_index > 0) {
          options[selected_index].error = '' //cleanse its error
          this.current_index = selected_index-1
          this.show(selected_index-1, screen_borders)
        }
      }
      else if (key.name === 'left') {
        //if it is a slider
        if (options[selected_index].type === 'slider') {
          // const new_value = Math.max(options[selected_index].value - 1, 1) //cannot go below 1
          // options[selected_index].value = new_value
          // this[options[selected_index].id] = new_value
          this[options[selected_index].id] = this[options[selected_index].id] - 1
          this.show(selected_index, screen_borders)
        }
      }
      else if (key.name === 'right') {
        //if it is a slider
        if (options[selected_index].type === 'slider') {
          // const new_value = options[selected_index].value + 1
          // options[selected_index].value = new_value
          this[options[selected_index].id] = this[options[selected_index].id] + 1
          this.show(selected_index, screen_borders)
        }
      }
      else if (key.name === 'return') {
        //only enter menu if it is a select
        if (options[selected_index].type === 'select') {
          process.stdin.removeAllListeners('keypress')
          this.current_index = selected_index //save the selected index
          this.menu(options[selected_index].id)
        }
      }
      //on key press
      else {
        //if an input is currently focused
        if (options[selected_index].input) { 
          //backspace has now sepcial ability
          if (key.name === 'backspace') { 
            //it visually removes one character
            options[selected_index].value = options[selected_index].value.slice(0, -1)
          } else {
            //but if its a suspicious key like 'home' and 'delete'
            if (key.sequence.charCodeAt(0) < 32 || (key.sequence.charCodeAt(0) >= 127 && key.sequence.charCodeAt(0) <= 159)) {
              //do nothing cuz these keys mess with the indents
            } 
            //but if it is a normal letter
            else {
              //add it to the options value
              options[selected_index].value += key.sequence; //save the keypress in its option
            }
          }
          //and then always
          options[selected_index].error = '' //cleanse its error after changing value
          this.show(selected_index, screen_borders) //reload the screen
        }
      }
    });
  }
  async intro(message, next_menu='main') {
    this.is_in_intro = true
    process.stdin.removeAllListeners('keypress')
    
    process.stdin.on('keypress', (str, key) => {
      if (key.ctrl && key.name === 'c') {
        process.exit();
      } else {
        //skip the animation
        if (this.is_in_intro) return this.is_in_intro = false
        //and if already skipped go to main menu
        process.stdout.write(this.COLORS.reset) //clean up the colors
        this.menu(next_menu)
      }
    });
    this.is_in_intro = true
    let displayedString = []
    for (let i = 0; i < message.length; i++) {
      if (!this.is_in_intro) {
        console.clear();
        return process.stdout.write(this.COLORS.reset + message);
      }
      console.clear();
      displayedString.push(message[i])
      process.stdout.write(`\x1b[38;5;${Math.min(Math.max(255-message.length, 232)+Math.round(i/(message.length/23)), 255)}m${displayedString.join('')}`);
      //wait for a delay so it the intro always takes exactly 2 seconds, no matter how long the text is
      await new Promise(resolve => setTimeout(() => {resolve()}, 2000/message.length))
    }
    this.is_in_intro = false
  }
  log(data) {
    this.to_log.push(data)
  }
  log_ip() {
    console.log('Host: ', this.game_server_address)
  }
  process_char(char='') {
    let text_to_display = '';
    let chars = char.split('')
    //if we have to display a player,
    //meaning the last letter contains a number,
    if (!isNaN(parseInt(chars[chars.length-1]))) {
      const player_number = parseInt(chars[chars.length-1])
      //then give it a new color based on the number
      text_to_display += `\x1b[48;5;${player_number + 7}m`

      //and if the first letter is a registered modifier, for example when attacked
      if (this.COLORS[chars[0]] !== undefined) {
        //then apply that modified style
        text_to_display += this.COLORS[chars[0]]
      } else {
        text_to_display += ' ' //important
      }
    } else {
      //if it is not a player, then give it its predefined color
      text_to_display = this.COLORS[char]
    }
    return text_to_display

  }
  render_health(amount) {
    let health = ''
    for (let i = 0; i < amount; i++) {
      health += '♥ '
    }
    return health + '                                        '
  }
  render(map) {
    console.clear();
    //data is a 2 dimentional array
    for (let i = 0; i < map.length; i++) {
      let row = ''
      for (let j = 0; j < map[i].length; j++) {
        row += this.process_char(map[i][j]).repeat(TILE_SIZE + 1)
      }
      for (let k = 0; k < TILE_SIZE; k++) {
        process.stdout.write(row + '\r\n')
      }
    }
    console.log(this.COLORS.reset);
  }
  update(data) {
    //update should also handle log events but it cant right now
    if (!data) return console.error('No data to update')
    //for performance, move the cursor to the pixels to change and change them manually.
    data.forEach((change) => {
      for (let k = 0; k < TILE_SIZE; k++) {
        //move the cursor to the pixel location
        readline.cursorTo(
          process.stdout, 
          change.x * (TILE_SIZE + 1), //scale with the TILE_SIZE
          change.y * TILE_SIZE + k
        ); //k is the amount of rows below
        
        process.stdout.write(this.process_char(change.what).repeat(TILE_SIZE + 1))
      }
    })
    process.stdout.write(this.COLORS.reset)
  }
  draw_border() {
    //function that draws the bottom and right border of the screen
    const width = this.screen_width
    const height = this.screen_height
    const chat_height = this.chat_height
    const char = '#'
    // const char = '#'.repeat(tile_size)

    // Escape sequences to move the cursor
    const ESC = '\x1b';
    const moveCursor = (row, col) => `${ESC}[${row};${col}H`;
    
    // Draw the right border
    for (let row = 1; row <= height; row++) {
        process.stdout.write(moveCursor(row, width) + char);
    }

    // Draw the bottom border
    process.stdout.write(moveCursor(height, 1) + char.repeat(width)); //optimize a bit

    // Draw the chat border
    process.stdout.write(moveCursor(height-chat_height, 1) + char.repeat(width)); //optimize a bit
    
    //reset the cursor to the top left
    process.stdout.write('\x1b[1;1H')
  }
  player_connect() {
    //initialize the player's client
    this.player_client = new Client(this.game_server_port, this.game_server_address, 'PlayerService')

    //ask the server to join ourselves
    this.player_join()

    this.player_client.on('message', (message) => {
      if (this.is_in_death_screen) return //dont update while in intro
         
      //if the server sends an important message, like a new player joined
      switch (message.type) {
        case 'map':
          this.render(message.data)
          break;
        case 'join': 
          //log in chat
          this.to_log.push(`Player ${message.data} joined`)
          break;
        case 'scoreboard':
          this.scoreboard = message.data
          break;
        case 'log':
          this.to_log.push(message.data)
          break
        case 'kill':
          //if this client dies, go to the death screen
          if (parseInt(message.victim) === parseInt(message.player.number)) {
            message.player.health = 0 //on death, the players health is resest, so we manually change it
            setTimeout(() => this.menu('death'), INVINCIBILITY_FRAMES)
          }
          break;
        case 'changes':
          this.update(message.data)
          break;
        default: 
          DEBUG('Unknown message received from server: ', message);
      }
      //move the cursor below the map
      readline.cursorTo(process.stdout, 0, MAP_HEIGHT*TILE_SIZE)

      // //this will move the curosr to the bottom right of the terminal
      // readline.cursorTo(process.stdout, this.rl.output.columns, this.rl.output.rows)

      let color = this.COLORS.reset
      //if the player is damaged, render the hearts red
      if (message.player?.damaged) color = '\x1b[38;5;196m'
      console.log(color + this.render_health(message.player?.health) + this.COLORS.reset);
      console.table(this.scoreboard);
      this.to_log.forEach(message => console.log(message + '                        '))
    })
  
    //but ofcourse, if the server is unreachable, a connection timeout will happen
    this.player_client.on('connection_timeout', () => {
      this.player_client.close() //close the client
      //go back to the play_online menu
      const options = this.current_options
      const index = this.current_index
      options[index].message = ''
      options[index].error = 'Connection failed'
      this.show()
      //cant find another way to display error messages from outside
    })
  
    this.player_client.on('server_close', () => {
      this.menu('server_close')
    })    
  }
  player_join() {
    this.is_in_death_screen = false
    this.player_client.send({}, 'join')
    // this.to_log = [] //clear any previous messages
  
    //give keyboard control to the player
    process.stdin.removeAllListeners('keypress')
    process.stdin.on('keypress', (str, key) => {
      if (key.ctrl && key.name === 'c') {
        process.exit();
      }
      else {
        this.player_client.action(key)
      }
    });

  }
}

const display = new Display()
display.intro(`${TITLE}\nMade by ArcadeFortune\n`)
