module.exports = {
	rules: {
		'@typescript-eslint/prefer-readonly-parameter-types': 'off',
		'no-void': ['error', {allowAsStatement: true}],
		'no-await-in-loop': 'off',
		'unicorn/prefer-module': 'off',
		'unicorn/prefer-node-protocol': 'off',
		'import/extensions': 'off'
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
