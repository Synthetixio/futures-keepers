const ethers = require('ethers');
const { gray, blue, red, green, yellow } = require('chalk');
const FuturesMarketABI = require('synthetix/build/artifacts/contracts/FuturesMarket.sol/FuturesMarket.json')
	.abi;
const ExchangeRatesABI = require('synthetix/build/artifacts/contracts/ExchangeRates.sol/ExchangeRates.json')
	.abi;
const PollRoutine = require('./poll-routine');

const EventEmitter = require('events').EventEmitter;

const DEFAULT_GAS_PRICE = '0';

class Keeper extends EventEmitter {
	// The index.

	constructor({
		proxyFuturesMarket: proxyFuturesMarketAddress,
		exchangeRates: exchangeRatesAddress,
		signer,
		provider,
	}) {
		super();
		const futuresMarket = new ethers.Contract(proxyFuturesMarketAddress, FuturesMarketABI, signer);
		this.futuresMarket = futuresMarket;

		const exchangeRates = new ethers.Contract(exchangeRatesAddress, ExchangeRatesABI, provider);
		this.exchangeRates = exchangeRates;

		this.liquidateRoutines = {};
		this.confirmRoutines = {};
		this.lastBlock = null;
		this.provider = provider;
	}

	run() {
		console.log(gray(`Listening for events on FuturesMarket [${this.futuresMarket.address}]`));
		this.on('block', async ({ blockNumber }) => {
			if (!this.lastBlock) {
				// Ethers.js begins on the last mined block, which we ignore.
				this.lastBlock = blockNumber;
				return;
			}

			// Check if oracle rates are updated.
			this.exchangeRates.on('RatesUpdated', () => {
				console.log('ExchangeRates', blue('RatesUpdated'));
				this.emit('price-update');
			});

			this.exchangeRates.on('RateDeleted', () => {
				console.log('ExchangeRates', blue('RateDeleted'));
				this.emit('price-update');
			});

			const events = await this.futuresMarket.queryFilter('*', blockNumber, blockNumber);
			console.log(gray(`New block: ${blockNumber}`));
			console.log('FuturesMarket', gray`${events.length} events to process`);
			this.processEvents(events);
		});

		this.provider.on('block', blockNumber => {
			this.emit('block', { blockNumber });
		});
	}

	processEvents(events) {
		events.forEach(({ event, args }) => {
			if (event === 'OrderSubmitted') {
				const { id, account } = args;
				console.log('FuturesMarket', blue('OrderSubmitted'), `[id=${id} account=${account}]`);
				this.confirmOrder(id, account);

				// Begin confirmOrder routine.
				if (!(id in this.confirmRoutines)) {
					const routine = new PollRoutine(() => this.confirmOrder(id, account), 1000);
					this.confirmRoutines[id] = routine;
					routine.run();
				}
			}
			if (event === 'OrderConfirmed') {
				const { id, account } = args;
				console.log('FuturesMarket', blue('OrderConfirmed'), `[id=${id} account=${account}]`);

				if (id in this.confirmRoutines) {
					this.confirmRoutines[id].cancel();
					delete this.confirmRoutines[id];
				}

				if (!(account in this.liquidateRoutines)) {
					// Begin liquidateOrder routine.
					const routine = new PollRoutine(() => this.liquidateOrder(id, account), 1000);
					this.liquidateRoutines[account] = routine;
					routine.run();
				}
			}
			if (event === 'PositionLiquidated') {
				const { account, liquidator } = args;
				console.log(
					'FuturesMarket',
					blue('PositionLiquidated'),
					`[account=${account} liquidator=${liquidator}]`
				);

				if (account in this.liquidateRoutines) {
					this.liquidateRoutines[account].cancel();
					delete this.liquidateRoutines[account];
				}
			}
		});
	}

	async confirmOrder(id, account) {
		console.log(
			`FuturesMarket [${this.futuresMarket.address}]`,
			`begin canConfirmOrder [id=${id}]`
		);
		const canConfirmOrder = await this.futuresMarket.canConfirmOrder(account);
		if (!canConfirmOrder) {
			console.error(
				`FuturesMarket [${this.futuresMarket.address}]`,
				`cannot confirm order [id=${id}]`
			);
			return;
		}

		console.log(`FuturesMarket [${this.futuresMarket.address}]`, `begin confirmOrder [id=${id}]`);
		let confirmOrderTx, receipt;

		try {
			confirmOrderTx = await this.futuresMarket.confirmOrder(account, {
				gasPrice: DEFAULT_GAS_PRICE,
				gasLimit: '3500000',
			});
			receipt = await confirmOrderTx.wait(1);
		} catch (err) {
			console.log(red(err));
			return;
		}

		console.log(
			`FuturesMarket [${this.futuresMarket.address}]`,
			`done confirmOrder [id=${id}]`,
			`success=${!!receipt.status}`,
			`tx=${receipt.transactionHash}`,
			yellow(`gasUsed=${receipt.gasUsed}`)
		);
	}

	async liquidateOrder(id, account) {
		console.log(
			`FuturesMarket [${this.futuresMarket.address}]`,
			`checking canLiquidate [id=${id}]`
		);
		const canLiquidateOrder = await this.futuresMarket.canLiquidate(account);
		if (!canLiquidateOrder) {
			// console.log(
			// 	`FuturesMarket [${this.futuresMarket.address}]`,
			// 	`cannot liquidate order [id=${id}]`
			// );
			return;
		}

		console.log(
			`FuturesMarket [${this.futuresMarket.address}]`,
			`begin liquidatePosition [id=${id}]`
		);
		let tx, receipt;

		try {
			tx = await this.futuresMarket.liquidatePosition(account, {
				gasPrice: DEFAULT_GAS_PRICE,
				gasLimit: '6500000',
			});
			receipt = await tx.wait(1);
		} catch (err) {
			console.log(red(err));
			return;
		}

		console.log(
			`FuturesMarket [${this.futuresMarket.address}]`,
			green(`done liquidatePosition [id=${id}]`),
			`success=${!!receipt.status}`,
			`tx=${receipt.transactionHash}`,
			yellow(`gasUsed=${receipt.gasUsed}`)
		);
	}
}

module.exports = Keeper;
