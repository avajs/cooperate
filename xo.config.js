module.exports = {
	rules: {
		'@typescript-eslint/prefer-readonly-parameter-types': 'off',
		'no-void': ['error', {allowAsStatement: true}],
		'no-await-in-loop': 'off'
	},
	overrides: [
		{
			files: '**/*.ts',
			rules: {
				'@typescript-eslint/no-floating-promises': ['error', {ignoreVoid: true}]
			}
		}
	]
};
