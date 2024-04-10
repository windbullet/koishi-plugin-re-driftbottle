// This file is modified from https://www.npmjs.com/package/koishi-plugin-driftbottle, under the MIT license
// Copyright haku530 2023

import { Context, Schema, Time, Random, h, Logger, Dict } from 'koishi'
import {} from "@koishijs/plugin-help"
import {} from "@koishijs/plugin-notifier"


export const name = 're-driftbottle'

export const usage = `本插件翻新自https://www.npmjs.com/package/koishi-plugin-driftbottle  
原插件因长期未维护已无法正常工作`

export interface Bottle {
  id: number;
  uid: string;
  gid: string;
  cnid: string;
  username: string;
  content: string;
  time: number;
}
export interface Comment {
  id: number;
  cid: number;
  bid: number;
  uid: string;
  gid: string;
  cnid: string;
  username: string;
  content: string;
  time: number;
}

export interface Config {
  manager: string[];
  allowPic: boolean;
  usePage: boolean;
  allowDropOthers: boolean;
  selfDrop: boolean;
  preview: boolean;
  maxRetry: number;
  retryInterval: number;
  debugMode: boolean;
  commentLimit?: number;
  bottleLimit?: number;
  randomSend: boolean;
  minInterval?: number;
  maxInterval?: number;
  guildId?: Dict
}

declare module 'koishi' {
  interface Tables {
      bottle: Bottle;
      comment: Comment;
  }
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    manager: Schema.array(Schema.string())
      .required()
      .description('管理员QQ，一个项目填一个ID'),
    allowPic: Schema.boolean()
      .description('是否允许发送图片')
      .default(true),
    allowDropOthers: Schema.boolean()
      .description('是否允许普通用户扔其他人的消息')
      .default(false),
    selfDrop: Schema.boolean()
      .description('扔别人的消息时是否算作自己扔的')
      .default(false),
    preview: Schema.boolean()
      .description('扔漂流瓶时是否返回漂流瓶预览（顺便检测能不能发出去）')
      .default(true),
    maxRetry: Schema.number()
      .description('漂流瓶发送失败时的最大重试次数')
      .default(5),
    retryInterval: Schema.number()
      .description('漂流瓶发送失败时的重试间隔（毫秒）')
      .default(500),
    debugMode: Schema.boolean()
      .description('漂流瓶发送失败时，在日志显示调用栈')
      .default(false)
  }),
  Schema.intersect([
    Schema.object({
      usePage: Schema.boolean()
        .description('显示评论或查看我的瓶子时使用分页以避免消息过长')
        .default(false)
    }),
    Schema.union([
      Schema.object({
        usePage: Schema.const(true).required(),
        commentLimit: Schema.number().description("捞漂流瓶时一页显示多少个评论").required(),
        bottleLimit: Schema.number().description("查看我的瓶子时一页显示多少个瓶子").required(),
      }),
      Schema.object({
        usePage: Schema.const(false),
      })
    ])
  ]),
  Schema.intersect([
    Schema.object({
      randomSend: Schema.boolean()
        .description('是否会随机时刻在随机群发送随机漂流瓶')
        .default(false),
    }),
    Schema.union([
      Schema.object({
        randomSend: Schema.const(true).required(),
        minInterval: Schema.number().description("在随机群发送随机漂流瓶的最小间隔（秒）").required(),
        maxInterval: Schema.number().description("在随机群发送随机漂流瓶的最大间隔（秒）").required(),
        guildId:Schema.dict(Schema.string())
          .role("table")
          .description("会发送消息的群聊ID，不填写平台名及ID代表该平台所有群，填写平台名不填写频道ID则代表不在该平台发消息\n\n键为平台（平台名以右下角状态栏为准），值为频道ID（频道ID间以半角逗号隔开）"),
      }),
      Schema.object({
        randomSend: Schema.const(false),
      })
    ])
  ])
])

export const inject = ["database", "notifier"]

export function apply(ctx: Context, config: Config) {
  const notifier = ctx.notifier.create()
  extendTables(ctx)

  if (config.randomSend) {
    async function countdown(time:number) {
      for (let i = time; i >= 0; i--) {
        notifier.update(`下一个随机漂流瓶将在 ${i} 秒后发送`)
        try {
          await ctx.sleep(1000)
        } catch {
          return
        }
      }
    }

    ctx.on("ready", async () => {
      while (true) {    
        let wait = Random.int(config.minInterval, config.maxInterval + 1)
        countdown(wait)
        try {
          await ctx.sleep(wait * 1000)
        } catch {
          return
        }
        for (let bot of ctx.bots) {
          let guilds = config.guildId[bot.platform]
          if (guilds === undefined) {
            let guilds = []
            for await (let i of bot.getGuildIter()) {
              guilds.push(i)
            }
            let bottles;
            bottles = await ctx.database.get("bottle", {})
            let retry = 0
            while (true) {
              const bottle = bottles[Random.int(0, bottles.length)];
              const {content, id, uid, username} = bottle;
              const chain = [];
              chain.push({ 
              'text': `一只编号为${id}的瓶子漂上了岸！破折号后是漂流瓶主人的昵称！\n发送“捞漂流瓶 ${id}”可以查看详细信息\n`, 
              });
              chain.push({ 
                'id': uid, 
                'text': content, 
                'username': username
              });
              let result = ""
              result += chain[0].text + '\n\n' + chain[1].text + `——${chain[1].username}`
              let guildId = Random.pick(guilds).id
              try {
                await bot.sendMessage(guildId, result)
                break
              } catch (e) {
                try {
                  let channels = []
                  for await (let channel of bot.getChannelIter(guildId)) {
                    if (channel.type === 0) channels.push(channel)
                  }
                  await bot.sendMessage(Random.pick(channels).id, result)
                  break
                } catch (e) {
                  retry++
                  let logger = new Logger('re-driftbottle')
                  if (retry > config.maxRetry) {
                    logger.warn(`${id}号漂流瓶发送失败（已重试${config.maxRetry}次）：${config.debugMode ? e.stack : e.name + ": " + e.message}`)
                    break
                  }
                  logger.warn(`${id}号漂流瓶发送失败（已重试${retry-1}/${config.maxRetry}次，将在${config.retryInterval}ms后重新抽一个瓶子重试）：${config.debugMode ? e.stack : e.name + ": " + e.message}`)
                  try {
                    await ctx.sleep(config.retryInterval)
                  } catch {
                    return
                  }
                  continue
                }
              }
            }
          } else {
            if (guilds === null || guilds.length === 0) continue
            let bottles;
            bottles = await ctx.database.get("bottle", {})
            let retry = 0
            while (true) {
              const bottle = bottles[Random.int(0, bottles.length)];
              const {content, id, uid, username} = bottle;
              const chain = [];
              chain.push({ 
              'text': `一只编号为${id}的瓶子漂上了岸！破折号后是漂流瓶主人的昵称！\n发送“捞漂流瓶 ${id}”可以查看详细信息\n`, 
              });
              chain.push({ 
                'id': uid, 
                'text': content, 
                'username': username
              });
              let result = ""
              result += chain[0].text + '\n\n' + chain[1].text + `——${chain[1].username}`
              let guildId = Random.pick(guilds.split(","))
              try {
                await bot.sendMessage(guildId as string, result)
                break
              } catch (e) {
                try {
                  let channels = []
                  for await (let channel of bot.getChannelIter(guildId as string)) {
                    if (channel.type === 0) channels.push(channel)
                  }
                  await bot.sendMessage(Random.pick(channels).id, result)
                  break
                } catch (e) {
                  retry++
                  let logger = new Logger('re-driftbottle')
                  if (retry > config.maxRetry) {
                    logger.warn(`${id}号漂流瓶发送失败（已重试${config.maxRetry}次）：${config.debugMode ? e.stack : e.name + ": " + e.message}`)
                    break
                  }
                  logger.warn(`${id}号漂流瓶发送失败（已重试${retry-1}/${config.maxRetry}次，将在${config.retryInterval}ms后重新抽一个瓶子重试）：${config.debugMode ? e.stack : e.name + ": " + e.message}`)
                  try {
                    await ctx.sleep(config.retryInterval)
                  } catch {
                    return
                  }
                  continue
                }
              }
            }
          }
        }
      }
    })
  }

  ctx.command("漂流瓶", "漂流瓶")
  
  ctx.command("漂流瓶.扔漂流瓶 [message:text]")
    .usage('扔漂流瓶 <内容>\n也可以引用回复一条消息（去掉@）来直接扔漂流瓶')
    .alias("扔漂流瓶")
    .action(async ({ session }, message) => {
      let quote = session.event.message.quote

      if (!message && !quote) return '请输入内容或引用回复一条消息'
      if ((quote && !config.manager.includes(session.event.user.id) && quote.user.id !== session.event.user.id) && !config.allowDropOthers) return '你没有权限扔别人的漂流瓶！'
      let uid
      if (config.selfDrop) {
        uid = session.event.user.id
      } else {
        uid = quote?.user.id ?? session.event.user.id
      }
      let gid = session.event?.guild?.id
      let cnid = session.event?.channel?.id
      let content = quote?.content ?? message;

      content = config.allowPic ? content : content.replace(/<.*?>/g, '')

      if (content.length > 500)
        return '内容过长！'
      if (content.length < 1)
        return '内容过短！'

      let preview = await ctx.database.create('bottle', {
        uid: uid, 
        gid: gid, 
        cnid: cnid,
        username: session.username,
        content: "“" + content + "”", 
        time: Time.getDateNumber()
      });
      
      if (config.preview) {
        let retry = 0
        while (true) {
          try {
            let bottleTime = new Date(preview.time * 86400000);
            let bottleTimeStr = `${bottleTime.getFullYear()}年${bottleTime.getMonth() + 1}月${bottleTime.getDate()}日`
            await session.bot.sendMessage(session.event.channel.id, `你的漂流瓶扔出去了！\n\n漂流瓶预览：\n${preview.username}：\n${preview.content}\n${bottleTimeStr}`)
            break
          } catch (e) {
            retry++
            let logger = new Logger('re-driftbottle')
            if (retry > config.maxRetry) {
              logger.warn(`${ preview.id }号漂流瓶预览发送失败（已重试${ config.maxRetry }次）：${config.debugMode ? e.stack : e.name + ": " + e.message}`)
              await session.send("这个漂流瓶无法发送，请查看日志！\n你可以尝试以下方法：\n保存图片后使用指令“扔漂流瓶 [图片]”（如果你要扔的是图片的话）\n缩短漂流瓶长度\n稍后重试\n联系开发者")
              await ctx.database.remove('bottle', { id: preview.id })
              logger.info(`${ preview.id }号漂流瓶已被删除`)
              break
            }
            logger.warn(`${ preview.id }号漂流瓶预览发送失败（已重试${retry-1}/${config.maxRetry}次，将在${config.retryInterval}ms后重试：${config.debugMode ? e.stack : e.name + ": " + e.message}`)
            try {
              await ctx.sleep(config.retryInterval)
            } catch {
              return
            }
            continue  
          }
        }
      } else {
        return '你的漂流瓶扔出去了！';
      }

    })

  ctx.command("漂流瓶.捞漂流瓶 [bottleId:posint] [page:posint]")
    .alias("捞漂流瓶")
    .usage('捞漂流瓶 <瓶子编号> [分页]\n不填瓶子编号则随机捞一个瓶子')
    .action(async ({ session }, bottleId, page) => {
      let bottles;
      if (!bottleId) {
        bottles = await ctx.database.get("bottle", {})
        if (!bottles || bottles.length < 1) return "没有瓶子了！"
      } else {
        bottles = await ctx.database.get("bottle", {id: bottleId})
        if (!bottles || bottles.length < 1) return "没有这个瓶子！"
      }
      let retry = 0
      while (true) {
        const bottle = bottles[Random.int(0, 
          bottles.length)];
        const {content, id, uid, username, time} = bottle;
        const commentsLength = (await ctx.database.get("comment", {bid: id})).length;
        const comments = await ctx.database
          .select('comment')
          .where({bid: id})
          .limit(config.usePage ? config.commentLimit : Infinity)
          .offset(config.usePage ? ((page ?? 1) - 1) * config.commentLimit : 0)
          .execute()
        const chain = [];
        chain.push({ 
        'text': h.text(`你捞到了一只编号为${id}的瓶子！内容前是漂流瓶主人的昵称，内容后是扔漂流瓶的日期！\n发送“捞漂流瓶 ${id} [分页]”可以查看评论区的其他分页\n发送“评论瓶子 ${id} <内容>”可以在下面评论这只瓶子\n发送“评论瓶子 [-r <评论编号>] ${id} <内容>”可以回复评论区的评论\n正文：`), 
        });
        chain.push({ 
          'id': uid, 
          'text': content, 
          'username': username,
          'time': time * 86400000
        });
        if (comments.length > 0)
          chain.push({ 
            'text': `----评论区，内容前为评论编号和用户昵称----`, 
          });
        for (const comment of comments) {
          const { username: commentName, content: commentContent, uid: commentUid, cid: commentId } = comment;
          chain.push({ 'id': commentId + ".", 'text': commentContent, 'username': commentName });
        }
        let bottleTime = new Date(chain[1].time);
        let bottleTimeStr = `${bottleTime.getFullYear()}年${bottleTime.getMonth() + 1}月${bottleTime.getDate()}日`
        let result = ""
        result += chain[0].text + '\n\n' + `${chain[1].username}：\n${chain[1].text}\n${bottleTimeStr}`;
        
        if (comments.length > 0) {
          result += "\n\n" + chain[2].text + "\n"
          for (let i of chain.slice(3)) {
            result += i.id + i.username + "：" + i.text + "\n"
          }
        }
        if (config.usePage && comments.length > 0) result += (`\n第${page ?? 1}/${Math.ceil(commentsLength / config.commentLimit)}页`)
        try {
          await session.bot.sendMessage(session.event.channel.id, result);
          break
        } catch (e) {
          retry++
          let logger = new Logger('re-driftbottle')
          if (retry > config.maxRetry) {
            logger.warn(`${id}号漂流瓶发送失败（已重试${config.maxRetry}次）：${config.debugMode ? e.stack : e.name + ": " + e.message}`)
            return "漂流瓶发送失败，请查看日志！"
          }
          logger.warn(`${id}号漂流瓶发送失败（已重试${retry-1}/${config.maxRetry}次，将在${config.retryInterval}ms后${!bottleId ? "重新抽一个瓶子" : ""}重试）：${config.debugMode ? e.stack : e.name + ": " + e.message}`)
          try {
            await ctx.sleep(config.retryInterval)
          } catch {
            return
          }
          continue
        }
      }

    })

    ctx.command('漂流瓶.评论瓶子 <id:posint> [ct:text]', '', {checkArgCount: true})
      .alias('评论瓶子')
      .usage('回复评论时，注意-r与评论编号间有空格，且该参数不能放到最后')
      .option('rid', '-r <rid: integer> 回复评论', { fallback: 0 })
      .example('评论瓶子 [-r <评论编号>] <瓶子编号> <内容>，[]内为可选参数，加上后代表要回复评论而不是评论瓶子')
      .action(async ({ session, options }, id, ct) => {
        const bottle = (await ctx.database.get('bottle', { id: id }))[0];
        if (!bottle) return '你要评论的瓶子不存在！';
        let replyId, comment;
        const rid = parseInt(options.rid) || 0;
        if (rid > 0) {
          replyId = rid;
          comment = (await ctx.database.get('comment', { bid: id, cid: replyId }))[0];
          if (!comment) return '你要回复的评论不存在！';
        }
        const quote = session.event.message.quote
        if (!ct && !quote) return '请输入内容或引用回复一条消息';
        if (quote && !config.manager.includes(session.event.user.id) && quote.user.id !== session.event.user.id) return '你没有权限扔别人的漂流瓶！';
        let uid = quote?.user.id ?? session.event.user.id;
        let gid = session.event?.guild?.id;
        let cnid = session.event?.channel?.id;
        const { uid: buid, gid: bgid, cnid: bcnid } = bottle;
        ct = config.allowPic ? ct : ct.replace(/<.*?>/g, '');
        if (ct.length > 500) return '内容过长！';
        if (ct.length < 1) return '内容过短！';
        ct = "“" + ct + "”"
        if (session.platform !== "qq") {
          for (const bot of ctx.bots) {
            let flag = true
            const guildList = bot.getGuildIter();
            let friendList
            try {
              friendList = bot.getFriendIter();
            } catch {
              flag = false
            }
            if (!replyId) {
              if (uid !== buid) {
                for await (let i of guildList) {
                  if (i.id === bgid || i.id === bcnid) {
                    try {
                      if (bcnid.length === 0) throw new Error('bcnid is empty');
                      await bot.sendMessage(bcnid, h("at", {id: buid}) + ` 你的${id}号瓶子有新评论！\n\n${ct}\n\n发送【捞漂流瓶 ${id}】查看详情`)
                    } catch (e) {
                      await bot.sendMessage(bgid, h("at", {id: buid}) + ` 你的${id}号瓶子有新评论！\n\n${ct}\n\n发送【捞漂流瓶 ${id}】查看详情`)
                    }
                    flag = false
                    break
                  }
                }
                if (flag) {
                  for await (let i of friendList) {
                    if (i.id === bcnid.replace("private:", "")) {
                      await bot.sendMessage(bcnid, ` 你的${id}号瓶子有新评论！\n\n${ct}\n\n发送【捞漂流瓶 ${id}】查看详情`)
                      break
                    }
                  }
                }
              }
            } else {
              const { username: commentUsername, uid: cuid, gid: cgid, cnid: ccnid } = comment;
              ct = `回复 ${replyId}. ${commentUsername}：${ct}`;
              if (cuid !== uid) {
                for await (let i of guildList) {
                  if (i.id === bgid || i.id === ccnid) {
                    const atUser = h("at", {id: cuid});
                    const message = `${atUser} ${id}号瓶子中你的${replyId}号评论有新回复！\n\n${ct}\n\n发送【捞漂流瓶 ${id}】查看详情`;
                    try {
                      if (ccnid.length === 0) throw new Error('ccnid is empty');
                      await bot.sendMessage(ccnid, message)
                    } catch (e) {
                      await bot.sendMessage(cgid, message);
                    }
                    flag = false
                    break;
                  }
                }
                if (flag) {
                  for await (let i of friendList) {
                    if (i.id === ccnid.replace("private:", "")) {
                      await bot.sendMessage(bcnid, ` ${id}号瓶子中你的${replyId}号评论有新回复！\n\n${ct}\n\n发送【捞漂流瓶 ${id}】查看详情`)
                      break
                    }
                  }
                }
              }
            }
          }
        }
        let data = await ctx.database.get('comment', { bid: id });
        let cid = data.length === 0 ? 1 : Math.max(...data.map(c => c.cid)) + 1;
        await ctx.database.create('comment', {
          cid: cid,
          bid: id, 
          uid: uid, 
          gid: gid, 
          cnid: cnid,
          username: session.username,
          content: ct, 
          time: Time.getDateNumber() 
        });

        if (config.preview) {
          let logger = new Logger("re-driftbottle")
          let retry = 0
          while (true) {
            try {
              await session.bot.sendMessage(session.event.channel.id, '你的评论已经扔出去了！\n评论预览：\n' + cid + "." + session.username + "：" + ct + "\n");
              break
            } catch (e) {
              retry++
              if (retry > config.maxRetry) {
                await session.send("这个评论无法发送，请查看日志！\n你可以尝试以下方法：\n保存图片后使用指令“评论瓶子 [瓶子编号] [图片]”（如果你要扔的是图片的话）\n缩短评论长度\n稍后重试\n联系开发者")
                logger.warn(`${id}号漂流瓶中的${cid}号评论预览发送失败（已重试${config.maxRetry}次）：${config.debugMode ? e.stack : e.name + ": " + e.message}`)
                await ctx.database.remove('comment', { bid: id, cid: cid });
                logger.info(`已删除${id}号漂流瓶中的${cid}号评论`)
                break
              }
              logger.warn(`${id}号漂流瓶中的${cid}号评论预览发送失败（已重试${retry-1}/${config.maxRetry}次，将在${config.retryInterval}ms后重试）：${config.debugMode ? e.stack : e.name + ": " + e.message}`)
              try {
                await ctx.sleep(config.retryInterval)
              } catch {
                return
              }
            }
          }
        }
      })

    ctx.command('漂流瓶.删除瓶子 <id:posint>', '', { checkArgCount: true})
      .alias("删除瓶子")
      .example('删除瓶子 <瓶子编号>')
      .action(async ({ session }, id) => {
        const bottle = (await ctx.database.get('bottle', { id: id }))[0];
        if (!bottle)
            return '你要删除的瓶子不存在！';
        if (!config.manager.includes(session.event.user.id) && session.event.user.id !== bottle.uid)
            return '你没有权限删除别人的瓶子！';
        await ctx.database.remove('bottle', { id: id });
        await ctx.database.remove('comment', { bid: id });
        return '瓶子删除了！';
      });

    ctx.command('漂流瓶.删除评论 <bid:posint> <cid:posint>', '', {checkArgCount: true})
      .alias("删除评论")
      .example('删除评论 <瓶子编号> <评论编号>')
      .action(async ({ session }, bid, cid) => {
        const comment = (await ctx.database.get('comment', {bid: bid, cid: cid }))[0];
        if (!comment)
          return '你要删除的评论不存在！';
        if (!config.manager.includes(session.event.user.id) && session.event.user.id !== comment.uid)
          return '你没有权限删除别人的评论！';
        await ctx.database.remove('comment', { bid: bid, cid: cid });
        return '评论删除了！';
      });

    ctx.command('漂流瓶.查看我的瓶子 [page:posint]', '')
      .alias('查看我的瓶子')
      .usage('查看我的瓶子 [分页]')
      .option('list', '-l 只输出瓶子编号，无分页')
      .action(async ({ session, options }, page) => {
        const bottlesLength = (await ctx.database.get("bottle", {uid: session.event.user.id})).length
        const bottles = await ctx.database
          .select("bottle")
          .where({ uid: session.event.user.id })
          .limit(!config.usePage || options.list ? Infinity : config.bottleLimit)
          .offset(!config.usePage || options.list ? 0 : ((page ?? 1) - 1) * config.bottleLimit)
          .execute()
        if (!bottles || bottles.length < 1) return '你还没有扔过瓶子！';
        const chain = [];
        chain.push(`你扔出去的瓶子有：`);
        if (options.list) {
          chain.push(bottles.map(bottle => bottle.id).join(' | '));
        } else {
          for (const bottle of bottles) {
            const { content, id } = bottle;
            chain.push(`瓶子编号${id}：${content}`);
          }
          if (config.usePage) chain.push(`\n第${page ?? 1}/${Math.ceil(bottlesLength / config.bottleLimit)}页`);
        }
        return chain.join('\n');
      })

    ctx.command('漂流瓶.删除过期瓶子 <days:posint>', '删除指定天数前的瓶子，防止数据库过大')
      .alias('删除过期瓶子')
      .example('删除过期瓶子 <天数>')
      .action(async ({ session }, days) => {
        if (!days) return '请输入天数！';
        if (!config.manager.includes(session.event.user.id)) return '你没有权限删除过期瓶子！';
        const deleteDays = days;
        const bottles = await ctx.database.get('bottle', { time: { $lt: Time.getDateNumber() - deleteDays } });
        if (!bottles || bottles.length < 1) return '没有过期的瓶子！';
        await ctx.database.remove('bottle', { time: { $lt: Time.getDateNumber() - deleteDays } });
        await ctx.database.remove('comment', { time: { $lt: Time.getDateNumber() - deleteDays } });
        await ctx.database.remove('comment', { bid: { $in: bottles.map((bottle) => bottle.id) } });
        return '过期瓶子已经被删除！';
      });

    ctx.command('漂流瓶.删除无效瓶子 [start:posint] [end:posint]', '列出指定编号闭区间内的无法发送的瓶子，不输入区间则列出所有无法发送的漂流瓶，可一键删除', {hidden: true})
      .alias('删除无效瓶子')
      .usage("警告：这个功能会将选中的所有漂流瓶发送出来，请自行承担风险")
      .example('删除无效瓶子 1 10')
      .action(async ({ session }, start, end) => {
        if (!config.manager.includes(session.event.user.id)) {
          return '你没有权限删除无效瓶子！';
        } else if (start && end === undefined) {
          return '请输入结束编号！';
        } else if (start > end) {
          return '起始编号不能大于结束编号！';
        }

        await session.send("警告：这个功能会将选中的所有漂流瓶发送出来，如果你确定要这么做，请在30秒内发送“是”")
        let confirm = await session.prompt(30000);
        if (confirm !== '是') return "已取消操作"
        await session.send("正在检测...")
        let brokenBottle = []
        let bottles = await ctx.database.get('bottle', { id: start ? { $gte: start, $lte: end } : {} });
        for (let bottle of bottles) {
          let retry = 0
          const {content, id, uid, username, time} = bottle;
          const chain = [];

          chain.push({ 
          'text': h.text(`你捞到了一只编号为${id}的瓶子！内容前是漂流瓶主人的昵称，内容后是扔漂流瓶的日期！\n发送“捞漂流瓶 ${id} [分页]”可以查看评论区的其他分页\n发送“评论瓶子 ${id} <内容>”可以在下面评论这只瓶子\n发送“评论瓶子 [-r <评论编号>] ${id} <内容>”可以回复评论区的评论\n正文：`), 
          });
          chain.push({ 
            'id': uid, 
            'text': content, 
            'username': username,
            'time': time * 86400000
          });

          let bottleTime = new Date(chain[1].time);
          let bottleTimeStr = `${bottleTime.getFullYear()}年${bottleTime.getMonth() + 1}月${bottleTime.getDate()}日`
          let result = ""
          result += chain[0].text + '\n\n' + `${chain[1].username}：\n${chain[1].text}\n${bottleTimeStr}`;

          while (true) {            
            try {
              await session.bot.sendMessage(session.event.channel.id, result);
              break
            } catch (e) {
              retry++
              if (retry > config.maxRetry) {
                brokenBottle.push(id)
                await session.send(`${ id }号漂流瓶无法发送`)
                break
              }
              try {
                await ctx.sleep(config.retryInterval)
              } catch {
                return
              }
              continue
            }
          }
        }

        if (brokenBottle.length === 0) return "未发现无法发送的漂流瓶！"
        let result = ""
        result += brokenBottle.join(", ")
        result += "号漂流瓶无法发送\n30秒内发送“删除”即可删除以上漂流瓶"
        await session.send(result)
        let reply = await session.prompt(30000)
        if (reply === "删除") {
          await ctx.database.remove("bottle", { id: { $in: brokenBottle } })
          let logger = new Logger("re-driftbottle")
          logger.info(`已删除${result += brokenBottle.join(", ")}号漂流瓶`)
          return "已删除以上漂流瓶"
        } else {
          return "已取消删除"
        }
      })

    ctx.command("漂流瓶.删除无效评论 [start:posint] [end:posint]", "列出指定编号闭区间内的瓶子下无法发送的评论，不输入区间则列出所有，可一键删除", {hidden: true})
      .alias("删除无效评论")
      .usage("警告：这个功能会将选中的所有漂流瓶下的评论发送出来，请自行承担风险")
      .example('删除无效评论 1 10')
      .action(async ({ session }, start, end) => {
        if (!config.manager.includes(session.event.user.id)) {
          return '你没有权限删除无效评论！';
        } else if (start && end === undefined) {
          return '请输入结束编号！';
        } else if (start > end) {
          return '起始编号不能大于结束编号！';
        }

        await session.send("警告：这个功能会将选中的所有漂流瓶下的评论发送出来，如果你确定要这么做，请在30秒内发送“是”")
        let confirm = await session.prompt(30000);
        if (confirm !== '是') return "已取消操作"
        await session.send("正在检测...")
        let brokenComment = new Map()
        let brokenCommentId = []
        let bottles = await ctx.database.get('bottle', { id: start ? { $gte: start, $lte: end } : {} });
        for (let bottle of bottles) {
          let comments = await ctx.database.get('comment', { bid: bottle.id });
          for (const comment of comments) {
            const { username: commentName, content: commentContent, uid: commentUid, cid: commentId, id: id } = comment;
            let retry = 0
            while (true) {            
              try {
                await session.bot.sendMessage(session.event.channel.id, commentId + "." + commentName + "：" + commentContent + "\n");
                break
              } catch (e) {
                retry++
                if (retry > config.maxRetry) {
                  brokenComment.set(bottle.id, brokenComment.has(bottle.id) ? [...brokenComment.get(bottle.id), commentId] : [commentId])
                  brokenCommentId.push(id)
                  await session.send(`${ bottle.id }号漂流瓶中的${ commentId }号评论无法发送`)
                  break
                }
                try {
                  await ctx.sleep(config.retryInterval)
                } catch {
                  return
                }
                continue
              }
            }
          }          
        }

        if (brokenComment.size === 0) return "未发现无法发送的评论！"
        let result = ""
        for (let [key, value] of brokenComment) {
          result += `${ key }号漂流瓶中的${ value.join(", ") }号评论无法发送\n`
        }
        result += "30秒内发送“删除”即可删除以上评论"
        await session.send(result)
        let reply = await session.prompt(30000)
        if (reply === "删除") {
          await ctx.database.remove("comment", { id: { $in: brokenCommentId } })
          return "已删除以上评论"
        } else {
          return "已取消删除"
        }
      })

}    
async function extendTables(ctx) {
  await ctx.model.extend('bottle', {
    id: 'unsigned',
    uid: 'string',
    gid: 'string',
    cnid: 'string',
    username: 'string',
    content: 'text',
    time: 'unsigned',
  }, {primary: "id", autoInc: true});

  await ctx.model.extend('comment', {
    id: 'unsigned',
    cid: 'unsigned',
    bid: 'unsigned',
    uid: 'string',
    gid: 'string',
    cnid: 'string',
    username: 'string',
    content: 'text',
    time: 'unsigned',
  }, {primary: "id", autoInc: true});
  
}
